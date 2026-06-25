// Client for the Poof gasless-withdrawal relayer (see /relayer). Optional: the
// whole feature is gated behind VITE_RELAYER_URL — unset → the wallet only ever
// self-submits withdrawals, exactly as before.
//
// Flow: fetch /info to learn the relayer's payout address + minimum fee, bind
// them into the withdraw proof (so the proof commits to who gets the fee), prove
// in-browser, then POST the proof to /relay. The relayer submits + pays the
// Stellar network fee; the user never touches the chain.
import { toHex } from "./crypto";
import type { ProofBytes } from "./proof";
import type { ExtDataWire } from "./chain";

export const RELAYER_URL =
  (import.meta.env.VITE_RELAYER_URL as string | undefined)?.replace(/\/+$/, "") || "";

export const relayerEnabled = (): boolean => RELAYER_URL.length > 0;

export interface RelayerInfo {
  relayerAddress: string;
  minFee: bigint;
  contractId: string;
  network?: string;
}

export async function getRelayerInfo(signal?: AbortSignal): Promise<RelayerInfo> {
  if (!RELAYER_URL) throw new Error("relayer not configured");
  const res = await fetch(`${RELAYER_URL}/info`, { signal });
  if (!res.ok) throw new Error(`relayer /info ${res.status}`);
  const j = await res.json();
  if (!j?.relayerAddress) throw new Error("relayer /info missing relayerAddress");
  return { relayerAddress: j.relayerAddress, minFee: BigInt(j.minFee ?? "0"), contractId: j.contractId, network: j.network };
}

/** Submit a proved withdraw to the relayer. Returns the on-chain tx hash. */
export async function relayWithdraw(
  proof: ProofBytes,
  publicSignals: Uint8Array[],
  ext: ExtDataWire,
  signal?: AbortSignal
): Promise<string> {
  if (!RELAYER_URL) throw new Error("relayer not configured");
  const body = {
    proof: { a: toHex(proof.a), b: toHex(proof.b), c: toHex(proof.c) },
    publicSignals: publicSignals.map(toHex),
    extData: {
      recipient: toHex(ext.recipient),
      relayer: toHex(ext.relayer),
      fee: ext.fee.toString(),
      ciphertext0: toHex(ext.ciphertext0),
      ciphertext1: toHex(ext.ciphertext1),
      viewTag0: ext.viewTag0,
      viewTag1: ext.viewTag1,
      settlementAddress: ext.settlementAddress,
      relayerAddress: ext.relayerAddress,
    },
  };
  const res = await fetch(`${RELAYER_URL}/relay`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j?.error ? `relayer: ${j.error}` : `relayer /relay ${res.status}`);
  if (!j?.hash) throw new Error("relayer returned no tx hash");
  return j.hash as string;
}
