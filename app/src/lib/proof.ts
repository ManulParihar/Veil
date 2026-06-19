// Format a snarkjs Groth16 proof + public signals into the contract's byte
// layout (INTERFACES §6): G1 = be(x)||be(y) (64B); G2 = be(x.c1)||be(x.c0)||
// be(y.c1)||be(y.c0) (128B — c1 FIRST; snarkjs gives [c0,c1] so we swap); Fr =
// 32B big-endian. Mirrors circuits/scripts/export_vk_rust.js exactly.
import { fieldToBytes } from "./crypto";

export interface SnarkProof {
  pi_a: string[]; // [x, y, "1"]
  pi_b: string[][]; // [[x_c0, x_c1], [y_c0, y_c1], ["1","0"]]
  pi_c: string[];
}

const be = (dec: string) => fieldToBytes(BigInt(dec));

function concat(...parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export function g1Bytes(p: string[]): Uint8Array {
  return concat(be(p[0]), be(p[1]));
}

export function g2Bytes(p: string[][]): Uint8Array {
  // snarkjs [c0, c1] → host [c1, c0]
  return concat(be(p[0][1]), be(p[0][0]), be(p[1][1]), be(p[1][0]));
}

export interface ProofBytes {
  a: Uint8Array; // 64
  b: Uint8Array; // 128
  c: Uint8Array; // 64
}

export function proofToBytes(proof: SnarkProof): ProofBytes {
  return { a: g1Bytes(proof.pi_a), b: g2Bytes(proof.pi_b), c: g1Bytes(proof.pi_c) };
}

/** 7 public signals (decimal strings, INTERFACES §3 order) → 7×32-byte arrays. */
export function publicSignalsToBytes(signals: string[]): Uint8Array[] {
  return signals.map((s) => be(s));
}
