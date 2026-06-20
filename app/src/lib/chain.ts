// Soroban integration: submit `transact`, read contract state, scan events.
// Uses @stellar/stellar-sdk against testnet RPC. The fee-payer is a plain
// Stellar account (separate from the Veil identity) that signs/pays.
import {
  rpc, Contract, TransactionBuilder, Keypair, Account, xdr, nativeToScVal,
  scValToNative, Address, Operation, Asset,
} from "@stellar/stellar-sdk";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { CONTRACT_ID, NETWORK_PASSPHRASE, RPC_URL, FRIENDBOT } from "./types";
import type { ProofBytes } from "./proof";
import type { Signer } from "./signer";
import { toHex, fromHex } from "./crypto";

const server = () => new rpc.Server(RPC_URL, { allowHttp: false });

/**
 * Derive the Stellar fee-payer keypair deterministically from the wallet seed,
 * so recovering a seed restores the SAME fee account (no device-local randomness
 * in a key path). Separate HKDF info string from the x25519 enc key so the two
 * never collide.
 */
export function feeKeypairFromSeed(seed: Uint8Array): Keypair {
  const raw = hkdf(sha256, seed, undefined, new TextEncoder().encode("veil-fee-stellar"), 32);
  return Keypair.fromRawEd25519Seed(Buffer.from(raw));
}

// ── ScVal builders for the contract's #[contracttype] structs ──
const sym = (s: string) => xdr.ScVal.scvSymbol(s);
const bytesV = (u8: Uint8Array) => xdr.ScVal.scvBytes(Buffer.from(u8));
function structV(obj: Record<string, xdr.ScVal>): xdr.ScVal {
  // Soroban map keys must be sorted; ASCII field names sort lexicographically.
  const entries = Object.keys(obj)
    .sort()
    .map((k) => new xdr.ScMapEntry({ key: sym(k), val: obj[k] }));
  return xdr.ScVal.scvMap(entries);
}

export interface ExtDataWire {
  recipient: Uint8Array; // 32
  relayer: Uint8Array; // 32
  fee: bigint;
  ciphertext0: Uint8Array;
  ciphertext1: Uint8Array;
  viewTag0: number;
  viewTag1: number;
  settlementAddress: string; // Stellar G-address strkey
}

function proofScVal(p: ProofBytes): xdr.ScVal {
  return structV({ a: bytesV(p.a), b: bytesV(p.b), c: bytesV(p.c) });
}
function signalsScVal(s: Uint8Array[]): xdr.ScVal {
  // s in INTERFACES §3 order:
  // [root, publicAmount, extDataHash, nf0, nf1, cm0, cm1, currencyId]
  return structV({
    root: bytesV(s[0]),
    public_amount: bytesV(s[1]),
    ext_data_hash: bytesV(s[2]),
    nullifier0: bytesV(s[3]),
    nullifier1: bytesV(s[4]),
    commitment0: bytesV(s[5]),
    commitment1: bytesV(s[6]),
    currency_id: bytesV(s[7]),
  });
}
function extScVal(e: ExtDataWire): xdr.ScVal {
  return structV({
    recipient: bytesV(e.recipient),
    relayer: bytesV(e.relayer),
    fee: nativeToScVal(e.fee, { type: "u128" }),
    ciphertext0: bytesV(e.ciphertext0),
    ciphertext1: bytesV(e.ciphertext1),
    view_tag0: nativeToScVal(e.viewTag0, { type: "u32" }),
    view_tag1: nativeToScVal(e.viewTag1, { type: "u32" }),
    settlement_address: Address.fromString(e.settlementAddress).toScVal(),
  });
}

// ── accounts ──

export async function friendbotFund(publicKey: string): Promise<void> {
  const res = await fetch(`${FRIENDBOT}?addr=${encodeURIComponent(publicKey)}`);
  if (!res.ok && res.status !== 400) throw new Error(`friendbot failed: ${res.status}`);
}

/** Classic-asset balance of `publicKey` for `code:issuer`, as a display string. */
export async function getAssetBalance(publicKey: string, code: string, issuer: string): Promise<string> {
  try {
    const res = await fetch(`https://horizon-testnet.stellar.org/accounts/${publicKey}`);
    if (!res.ok) return "0";
    const data = await res.json();
    const bal = (data.balances ?? []).find(
      (b: any) => b.asset_code === code && b.asset_issuer === issuer
    );
    return bal ? bal.balance : "0";
  } catch {
    return "0";
  }
}

/**
 * Drip a custom asset to the `recipient` account: establishes the trustline
 * (authorised by the recipient, who owns it) and pays `amount` from the faucet
 * distributor (signed by the faucet key), in one atomic classic transaction.
 * The recipient is whichever account is active — a local seed identity or a
 * connected external wallet — so it co-signs via its Signer. Returns the tx
 * hash. The distributor is the tx source and pays the network fee.
 */
export async function faucetDrip(opts: {
  recipient: Signer;
  faucetSecret: string;
  assetCode: string;
  issuer: string;
  amount: string;
}): Promise<string> {
  const s = server();
  const faucetKp = Keypair.fromSecret(opts.faucetSecret);
  const asset = new Asset(opts.assetCode, opts.issuer);
  const source = await s.getAccount(faucetKp.publicKey());

  const tx = new TransactionBuilder(source, { fee: "1000000", networkPassphrase: NETWORK_PASSPHRASE })
    // trustline change is authorised by the recipient (it owns the trustline);
    // re-running with the default max limit is harmless if it already exists.
    .addOperation(Operation.changeTrust({ asset, source: opts.recipient.publicKey }))
    .addOperation(Operation.payment({
      destination: opts.recipient.publicKey,
      asset,
      amount: opts.amount,
      source: faucetKp.publicKey(),
    }))
    .setTimeout(120)
    .build();
  // The recipient signs its own changeTrust first; the distributor then adds its
  // signature for the source/payment.
  const co = await opts.recipient.signTransaction(tx);
  co.sign(faucetKp);

  const sent = await s.sendTransaction(co);
  if (sent.status === "ERROR") throw new Error(`faucet submit error: ${JSON.stringify(sent.errorResult)}`);
  let final = await s.getTransaction(sent.hash);
  for (let i = 0; i < 30 && final.status === "NOT_FOUND"; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    final = await s.getTransaction(sent.hash);
  }
  if (final.status !== "SUCCESS") throw new Error(`faucet failed on-chain: ${final.status}`);
  return sent.hash;
}

export async function getXlmBalance(publicKey: string): Promise<string> {
  try {
    const res = await fetch(`https://horizon-testnet.stellar.org/accounts/${publicKey}`);
    if (!res.ok) return "0";
    const data = await res.json();
    const native = (data.balances ?? []).find((b: any) => b.asset_type === "native");
    return native ? native.balance : "0";
  } catch {
    return "0";
  }
}

// ── read-only contract calls (via simulate) ──
async function simulateRead(sourcePublicKey: string, method: string, ...args: xdr.ScVal[]): Promise<any> {
  const s = server();
  let account: Account;
  try {
    account = await s.getAccount(sourcePublicKey);
  } catch {
    account = new Account(sourcePublicKey, "0");
  }
  const tx = new TransactionBuilder(account, { fee: "100000", networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(new Contract(CONTRACT_ID).call(method, ...args))
    .setTimeout(30)
    .build();
  const sim = await s.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(sim.error);
  const retval = (sim as rpc.Api.SimulateTransactionSuccessResponse).result?.retval;
  return retval ? scValToNative(retval) : null;
}

export async function getCurrentRoot(sourcePublicKey: string): Promise<string> {
  const v = await simulateRead(sourcePublicKey, "current_root");
  return toHex(v as Uint8Array);
}
export async function getNextLeafIndex(sourcePublicKey: string): Promise<number> {
  return Number(await simulateRead(sourcePublicKey, "next_leaf_index"));
}
export async function isSpent(sourcePublicKey: string, nf: Uint8Array): Promise<boolean> {
  return Boolean(await simulateRead(sourcePublicKey, "is_spent", bytesV(nf)));
}

// ── submit transact ──
export interface SubmitResult {
  hash: string;
  newRoot: string;
  leafIndices: [number, number];
}

export async function submitTransact(
  signer: Signer,
  proof: ProofBytes,
  publicSignals: Uint8Array[],
  ext: ExtDataWire
): Promise<SubmitResult> {
  const s = server();
  const account = await s.getAccount(signer.publicKey);
  const nextBefore = await getNextLeafIndex(signer.publicKey).catch(() => 0);

  const op = new Contract(CONTRACT_ID).call(
    "transact",
    proofScVal(proof),
    signalsScVal(publicSignals),
    extScVal(ext)
  );
  const tx = new TransactionBuilder(account, { fee: "1000000", networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(op)
    .setTimeout(120)
    .build();

  // Simulate, then EXPLICITLY sign the auth entries the deposit's token.transfer
  // requires (a non-root require_auth on the depositor). The depositor is the
  // signer (fee-payer), so we authorize each address-credential entry with it.
  const sim = await s.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(`simulate: ${sim.error}`);
  const validUntil = (await s.getLatestLedger()).sequence + 100;
  const auth = (sim as rpc.Api.SimulateTransactionSuccessResponse).result?.auth ?? [];
  if (auth.length) {
    const signed = await Promise.all(
      auth.map((e) =>
        e.credentials().switch().name === "sorobanCredentialsAddress"
          ? signer.authorizeEntry(e, validUntil)
          : Promise.resolve(e)
      )
    );
    (sim as rpc.Api.SimulateTransactionSuccessResponse).result!.auth = signed;
  }
  const prepared = rpc.assembleTransaction(tx, sim).build();
  const signedPrepared = await signer.signTransaction(prepared);
  const sent = await s.sendTransaction(signedPrepared);
  if (sent.status === "ERROR") throw new Error(`submit error: ${JSON.stringify(sent.errorResult)}`);

  const hash = sent.hash;
  // poll
  let final = await s.getTransaction(hash);
  for (let i = 0; i < 30 && final.status === "NOT_FOUND"; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    final = await s.getTransaction(hash);
  }
  if (final.status !== "SUCCESS") {
    throw new Error(`transact failed on-chain: ${final.status}`);
  }
  const newRoot = await getCurrentRoot(signer.publicKey).catch(() => "");
  return { hash, newRoot, leafIndices: [nextBefore, nextBefore + 1] };
}

// ── event scan (NewCommit) ──
export interface CommitmentEvent {
  commitment: Uint8Array;
  leafIndex: number;
  ciphertext: Uint8Array;
  viewTag: number;
  ledger: number;
}

export async function getNewCommitments(startLedger?: number): Promise<CommitmentEvent[]> {
  const s = server();
  const latest = await s.getLatestLedger();
  // The RPC scans only a bounded ledger window per getEvents call, so a start far
  // in the past yields an empty first page. Start within ~6h of head (well inside
  // RPC retention); the durable indexer (PLANE 4b) is the answer for full history.
  const from = startLedger ?? Math.max(latest.sequence - 6000, 1);
  const LIMIT = 200;
  const out: CommitmentEvent[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 30; page++) {
    const resp: any = await s.getEvents({
      ...(cursor ? { cursor } : { startLedger: from }),
      filters: [{ type: "contract", contractIds: [CONTRACT_ID] }],
      limit: LIMIT,
    } as any);
    const evs = resp.events ?? [];
    for (const ev of evs) {
      const topics = ev.topic.map((t: xdr.ScVal) => scValToNative(t));
      if (topics[0] !== "NewCommit") continue;
      const data = scValToNative(ev.value);
      // tuple (commitment, leaf_index, ciphertext, view_tag)
      out.push({
        commitment: Uint8Array.from(data[0] as Uint8Array),
        leafIndex: Number(data[1]),
        ciphertext: Uint8Array.from(data[2] as Uint8Array),
        viewTag: Number(data[3]),
        ledger: Number(ev.ledger),
      });
    }
    // last page reached when fewer than LIMIT events come back
    if (evs.length < LIMIT || !resp.cursor) break;
    cursor = resp.cursor;
  }
  // dedupe by leaf index (idempotent) and order
  const byIdx = new Map<number, CommitmentEvent>();
  for (const e of out) byIdx.set(e.leafIndex, e);
  return [...byIdx.values()].sort((a, b) => a.leafIndex - b.leafIndex);
}

export { toHex, fromHex, Address };
