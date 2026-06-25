// Submit a user's withdraw `transact` and pay the Stellar network fee. A withdraw
// places no `require_auth` on the user's notes (the ZK proof IS the
// authorization, and funds are released from the pool's own custody), so the
// relayer can submit and sign the envelope entirely on its own — the user never
// touches the chain, never reveals an address that paid a fee. The relayer is
// compensated by the in-proof `fee`, which the contract pays to `relayerAddress`.
import {
  rpc, Contract, TransactionBuilder, Keypair, Account, xdr,
} from "@stellar/stellar-sdk";
import { proofScVal, signalsScVal, extScVal, type ProofHex, type ExtDataHex } from "./encode.js";
import type { Config } from "./config.js";

export interface RelayRequest {
  proof: ProofHex;
  publicSignals: string[]; // 8 × hex32
  extData: ExtDataHex;
}

export interface RelayResult { hash: string; }

/** Reject anything that isn't a well-formed, relayer-payable withdraw. */
export function validateRequest(req: RelayRequest, cfg: Config): string | null {
  if (!req?.proof?.a || !req.proof.b || !req.proof.c) return "missing proof";
  if (!Array.isArray(req.publicSignals) || req.publicSignals.length !== 8) return "publicSignals must have 8 entries";
  const ext = req.extData;
  if (!ext) return "missing extData";
  // The fee is paid to relayerAddress — it MUST be this relayer, or we'd submit
  // (and pay gas) for someone else's payout.
  if (ext.relayerAddress !== cfg.relayerPublicKey) return "relayerAddress is not this relayer";
  let fee: bigint;
  try { fee = BigInt(ext.fee); } catch { return "fee is not an integer"; }
  if (fee < cfg.minFee) return `fee ${fee} below relayer minimum ${cfg.minFee}`;
  // publicAmount[1] must be a withdraw (non-zero) — relaying only makes sense for
  // withdrawals (transfers/deposits move no pool funds to pay a fee from).
  const pa = req.publicSignals[1].replace(/^0x/, "");
  if (/^0*$/.test(pa)) return "not a withdraw (publicAmount is zero)";
  return null;
}

export async function relay(req: RelayRequest, cfg: Config): Promise<RelayResult> {
  const server = new rpc.Server(cfg.rpcUrl, { allowHttp: cfg.rpcUrl.startsWith("http://") });
  const kp = Keypair.fromSecret(cfg.relayerSecret);
  const source: Account = await server.getAccount(kp.publicKey());

  const op = new Contract(cfg.contractId).call(
    "transact",
    proofScVal(req.proof),
    signalsScVal(req.publicSignals),
    extScVal(req.extData)
  );
  const tx = new TransactionBuilder(source, { fee: cfg.baseFee, networkPassphrase: cfg.networkPassphrase })
    .addOperation(op)
    .setTimeout(120)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(`simulate: ${sim.error}`);
  // A withdraw carries no address-credential auth (no user require_auth); if the
  // simulation ever returns one, refuse rather than silently sign someone's auth.
  const auth = (sim as rpc.Api.SimulateTransactionSuccessResponse).result?.auth ?? [];
  for (const e of auth) {
    if (e.credentials().switch().name === "sorobanCredentialsAddress") {
      throw new Error("unexpected address auth in withdraw — refusing to relay");
    }
  }

  const prepared = rpc.assembleTransaction(tx, sim).build();
  prepared.sign(kp);
  const sent = await server.sendTransaction(prepared);
  if (sent.status === "ERROR") throw new Error(`submit error: ${JSON.stringify(sent.errorResult)}`);

  let final = await server.getTransaction(sent.hash);
  for (let i = 0; i < 30 && final.status === "NOT_FOUND"; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    final = await server.getTransaction(sent.hash);
  }
  if (final.status !== "SUCCESS") throw new Error(`transact failed on-chain: ${final.status}`);
  return { hash: sent.hash };
}

// re-export for tests / callers
export type { ProofHex, ExtDataHex };
export { xdr };
