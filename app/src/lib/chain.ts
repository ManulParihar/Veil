// Soroban integration: submit `transact`, read contract state, scan events.
// Uses @stellar/stellar-sdk against testnet RPC. The fee-payer is a plain
// Stellar account (separate from the Poof identity) that signs/pays.
import {
  rpc, Contract, TransactionBuilder, Keypair, Account, xdr, nativeToScVal,
  scValToNative, Address, Operation, Asset,
} from "@stellar/stellar-sdk";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { CONTRACT_ID, CONTRACT_START_LEDGER, NETWORK_PASSPHRASE, RPC_URL, FRIENDBOT } from "./types";
import type { ProofBytes } from "./proof";
import type { Signer } from "./signer";
import { toHex, fromHex } from "./crypto";

const server = () => new rpc.Server(RPC_URL, { allowHttp: false });

// Optional durable indexer (the Rust `poof-indexer`, e.g. on Railway). When set,
// it backfills commitment history that Soroban RPC has aged out of its ~7-day
// retention window. Purely a fallback: unset → behavior is exactly RPC-only.
const INDEXER_URL = (import.meta.env.VITE_INDEXER_URL as string | undefined)?.replace(/\/+$/, "") || "";

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
  relayerAddress: string; // Stellar G-address strkey (relayer payout)
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
    relayer_address: Address.fromString(e.relayerAddress).toScVal(),
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

// Fetch the full durable commitment history from the indexer's read API.
// Shape: GET /notes?since_index=N → [{ cm, idx, ct, view_tag }] (hex + numbers).
async function getIndexerCommitments(sinceIndex = 0): Promise<CommitmentEvent[]> {
  const res = await fetch(`${INDEXER_URL}/notes?since_index=${sinceIndex}`);
  if (!res.ok) throw new Error(`indexer /notes ${res.status}`);
  const rows = (await res.json()) as { cm: string; idx: number; ct: string; view_tag: number }[];
  // `ledger` is unused for tree reconstruction (leafIndex ordering is what matters).
  return rows.map((r) => ({
    commitment: fromHex(r.cm),
    leafIndex: r.idx,
    ciphertext: fromHex(r.ct),
    viewTag: r.view_tag,
    ledger: 0,
  }));
}

// Minimal slice of `rpc.Server` the event scan needs. Declaring it lets the
// paging/retention logic be unit-tested with a fake server (no network).
export interface EventScanner {
  getHealth(): Promise<{ oldestLedger?: number }>;
  getEvents(req: any): Promise<{ events?: any[]; cursor?: string; latestLedger?: number }>;
}

/**
 * Page a contract's events from `from`, tolerating Soroban RPC's rolling ~7-day
 * retention window. Returns the raw events (caller parses) plus `clamped` — true
 * when the start ledger had to be raised above `from` because it predated the
 * retained window, which means the RPC prefix is gone and a complete tree needs
 * the durable indexer.
 *
 * Two retention defenses:
 *  • Proactive: `getHealth().oldestLedger` is the floor; clamp `from` into range
 *    up front so `getEvents` is never rejected for being too old (no error to
 *    scrape, works on every path).
 *  • Reactive (fallback if getHealth is unavailable): if `getEvents` still rejects
 *    with "…within the ledger range: <floor> - <latest>", parse the floor and
 *    clamp up. Only before paging begins (no cursor yet).
 *
 * Termination is dead-zone-safe: a clamped scan starts far below the contract's
 * first event, so the gap pages come back EMPTY but WITH a forward cursor. An
 * empty page is treated as "caught up to head" only once we've actually collected
 * events; before that we keep paging through the gap (the old code stopped on the
 * first empty page and returned an empty, corrupt tree).
 */
export async function scanContractEvents(
  s: EventScanner,
  contractId: string,
  from: number,
): Promise<{ events: any[]; clamped: boolean }> {
  let clamped = false;
  try {
    const { oldestLedger } = await s.getHealth();
    if (oldestLedger && from < oldestLedger) { from = oldestLedger + 1; clamped = true; }
  } catch { /* best-effort; reactive clamp below still covers a rejection */ }

  const LIMIT = 200;
  // Budget generously: a clamped scan may traverse a ~109k-ledger gap (~30 empty
  // pages) before reaching activity; in-range scans finish in a handful.
  const MAX_PAGES = 400;
  const out: any[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    let resp: { events?: any[]; cursor?: string };
    try {
      resp = await s.getEvents({
        ...(cursor ? { cursor } : { startLedger: from }),
        filters: [{ type: "contract", contractIds: [contractId] }],
        limit: LIMIT,
      });
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      const m = /(\d{6,})/.exec(msg);
      // Before paging starts: a too-old startLedger is rejected with the retained
      // range ("…ledger range: <floor> - <latest>"). Clamp up to the floor (this is
      // the reactive fallback when getHealth was unavailable) and retry.
      if (!cursor && m && Number(m[1]) > from) {
        from = Number(m[1]) + 1;
        clamped = true;
        continue;
      }
      // While paging: the cursor can advance to/just past the chain tip, and the
      // RPC then rejects it with the SAME "…ledger range…" message instead of
      // returning an empty page. That only means we've reached head — we already
      // have every event up to the cursor, so stop cleanly. (This is the common,
      // intermittent trigger of the user-visible range error: a sync that pages to
      // the tip and asks for one page too many.)
      if (cursor && /ledger range/i.test(msg)) break;
      throw e;
    }
    const evs = resp.events ?? [];
    for (const ev of evs) out.push(ev);
    cursor = resp.cursor;
    if (!cursor) break;
    if (evs.length === 0 && out.length > 0) break; // empty page AFTER data ⇒ at head
  }
  return { events: out, clamped };
}

export async function getNewCommitments(startLedger?: number): Promise<CommitmentEvent[]> {
  const s = server();
  // Start from the contract's deploy ledger so the tree includes leaf 0 — a fixed
  // recent window misses the earliest commitments and corrupts the whole tree
  // (wrong leaf indices → wrong root). scanContractEvents clamps into RPC
  // retention; an aged-out prefix is restored from the durable indexer below.
  const fullScan = startLedger === undefined;
  const from = startLedger ?? CONTRACT_START_LEDGER;
  const { events: raw, clamped } = await scanContractEvents(s, CONTRACT_ID, from);
  const out: CommitmentEvent[] = [];
  for (const ev of raw) {
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
  // Durable backfill: on a full scan, if RPC retention forced us to start above
  // the deploy ledger (clamped) or the earliest leaf is missing, the tree is
  // incomplete. Pull the full history from the indexer and merge. Best-effort —
  // a down/unset indexer never breaks the working RPC path.
  let backfill: CommitmentEvent[] = [];
  const earliestMissing = out.length === 0 || Math.min(...out.map((e) => e.leafIndex)) > 0;
  if (INDEXER_URL && fullScan && (clamped || earliestMissing)) {
    try {
      backfill = await getIndexerCommitments(0);
    } catch (err) {
      console.warn("indexer backfill failed; using RPC-only scan", err);
    }
  }
  // dedupe by leaf index (idempotent) and order. Seed with indexer rows, then let
  // fresher RPC events overwrite for any shared leaf (payloads match; RPC carries
  // the real ledger). Result is the union ordered by leaf index.
  const byIdx = new Map<number, CommitmentEvent>();
  for (const e of backfill) byIdx.set(e.leafIndex, e);
  for (const e of out) byIdx.set(e.leafIndex, e);
  const merged = [...byIdx.values()].sort((a, b) => a.leafIndex - b.leafIndex);
  // If RPC retention forced a clamp and the durable backfill could not restore the
  // aged-out prefix (indexer empty/unavailable), the tree is missing its earliest
  // leaves — leaf indices and the root would be wrong. Fail loudly with an
  // actionable message instead of silently returning a corrupt/empty tree. (Not
  // reached while the contract is within retention: clamped is false.)
  if (clamped && (merged.length === 0 || merged[0].leafIndex > 0)) {
    throw new Error(
      "Contract event history has aged out of Soroban RPC's ~7-day retention window " +
      "and the durable indexer returned no data — cannot rebuild the full commitment " +
      "tree. Start/repair the poof-indexer (VITE_INDEXER_URL).",
    );
  }
  return merged;
}

export { toHex, fromHex, Address };
