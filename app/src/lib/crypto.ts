// Veil client crypto — the browser's single source of note math, bit-identical
// to crates/veil-crypto and the circom circuit. Poseidon comes from circomlibjs
// (the same iden3 reference circomlib compiles from), so hashes match the
// on-chain contract and the proof system. Verified against the pinned veil-crypto
// vectors in crypto.test.ts.

import { buildPoseidon } from "circomlibjs";
import { x25519 } from "@noble/curves/ed25519";
import { chacha20poly1305 } from "@noble/ciphers/chacha";
import { sha256 } from "@noble/hashes/sha256";
import { hkdf } from "@noble/hashes/hkdf";
import { keccak256 } from "js-sha3";

/** BN254 scalar field modulus r. */
export const R =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

type PoseidonFn = ((inputs: bigint[]) => Uint8Array) & {
  F: { toString: (x: Uint8Array) => string; toObject: (x: Uint8Array) => bigint };
};

let _poseidon: PoseidonFn | null = null;

/** Initialise Poseidon (async, once). Must be awaited before any hash call. */
export async function initCrypto(): Promise<void> {
  if (!_poseidon) _poseidon = (await buildPoseidon()) as PoseidonFn;
}

function P(): PoseidonFn {
  if (!_poseidon) throw new Error("crypto not initialised — await initCrypto()");
  return _poseidon;
}

/** Poseidon over `inputs`, returning the field element as a bigint. */
export function poseidon(inputs: bigint[]): bigint {
  const p = P();
  return p.F.toObject(p(inputs)) % R;
}

export const hash1 = (a: bigint) => poseidon([a]);
export const hash2 = (a: bigint, b: bigint) => poseidon([a, b]);
export const hash3 = (a: bigint, b: bigint, c: bigint) => poseidon([a, b, c]);
export const compress = (l: bigint, r: bigint) => hash2(l, r);

// ── field <-> bytes (32-byte big-endian, the Veil wire encoding) ──

export function bytesToField(bytes: Uint8Array): bigint {
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return v % R;
}

export function fieldToBytes(x: bigint): Uint8Array {
  let v = ((x % R) + R) % R;
  const out = new Uint8Array(32);
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

export const toHex = (b: Uint8Array) =>
  Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
export const fromHex = (h: string) => {
  const s = h.startsWith("0x") ? h.slice(2) : h;
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
};
export const fieldToHex = (x: bigint) => toHex(fieldToBytes(x));

// ── key hierarchy (mirrors veil-crypto::Seed) ──

export interface Keys {
  seed: Uint8Array; // 32 bytes
  spendKey: bigint; // sk = Poseidon(seedFr, 0)
  publicKey: bigint; // pk = Poseidon(sk)
  ivk: bigint; // Poseidon(seedFr, 2)
  ovk: bigint; // Poseidon(seedFr, 3)
  encSecret: Uint8Array; // X25519 secret = HKDF-SHA256(seed, "veil-enc")
  encPublic: Uint8Array; // X25519 public
}

export function deriveKeys(seed: Uint8Array): Keys {
  if (seed.length !== 32) throw new Error("seed must be 32 bytes");
  const seedFr = bytesToField(seed);
  const spendKey = hash2(seedFr, 0n);
  const publicKey = hash1(spendKey);
  const ivk = hash2(seedFr, 2n);
  const ovk = hash2(seedFr, 3n);
  // X25519 enc key: HKDF-SHA256(seed, info="veil-enc") → 32-byte secret
  const encSecret = hkdf(sha256, seed, undefined, new TextEncoder().encode("veil-enc"), 32);
  const encPublic = x25519.getPublicKey(encSecret);
  return { seed, spendKey, publicKey, ivk, ovk, encSecret, encPublic };
}

// ── notes ──

export interface Note {
  amount: bigint;
  pubkey: bigint;
  blinding: bigint;
}

/** commitment = Poseidon(amount, pubkey, blinding). */
export const commitment = (n: Note) => hash3(n.amount, n.pubkey, n.blinding);

/** signature = Poseidon(sk, commitment, pathIndex). */
export const signature = (sk: bigint, cm: bigint, pathIndex: bigint) =>
  hash3(sk, cm, pathIndex);

/** nullifier = Poseidon(commitment, pathIndex, signature). */
export function nullifier(n: Note, sk: bigint, pathIndex: bigint): bigint {
  const cm = commitment(n);
  return hash3(cm, pathIndex, signature(sk, cm, pathIndex));
}

/** Empty-leaf value Zero(0) = Poseidon(0). */
export const zeroLeaf = () => hash1(0n);

// ── note encryption (X25519 ECDH → ChaCha20Poly1305 + 1-byte view tag) ──
// Wire blob = ephemeral_pub(32) || aead_ct, matching veil-sdk::encrypt.

const KEY_DOMAIN = new TextEncoder().encode("veil-note-key");

function noteToPlaintext(n: Note): Uint8Array {
  const out = new Uint8Array(72);
  // amount as 8-byte big-endian (u64)
  let a = n.amount;
  for (let i = 7; i >= 0; i--) { out[i] = Number(a & 0xffn); a >>= 8n; }
  out.set(fieldToBytes(n.pubkey), 8);
  out.set(fieldToBytes(n.blinding), 40);
  return out;
}

function plaintextToNote(pt: Uint8Array): Note | null {
  if (pt.length !== 72) return null;
  let amount = 0n;
  for (let i = 0; i < 8; i++) amount = (amount << 8n) | BigInt(pt[i]);
  return { amount, pubkey: bytesToField(pt.slice(8, 40)), blinding: bytesToField(pt.slice(40, 72)) };
}

function deriveAead(shared: Uint8Array): { viewTag: number; key: Uint8Array } {
  const viewTag = sha256(shared)[0];
  const key = sha256(new Uint8Array([...KEY_DOMAIN, ...shared]));
  return { viewTag, key };
}

export interface EncryptedNote {
  ephemeralPub: Uint8Array; // 32
  viewTag: number;
  ciphertext: Uint8Array; // 88 (72 + 16 tag)
}

const ZERO_NONCE = new Uint8Array(12);

export function encryptNote(recipientEncPub: Uint8Array, note: Note): EncryptedNote {
  const ephemeralSecret = x25519.utils.randomPrivateKey();
  const ephemeralPub = x25519.getPublicKey(ephemeralSecret);
  const shared = x25519.getSharedSecret(ephemeralSecret, recipientEncPub);
  const { viewTag, key } = deriveAead(shared);
  const ciphertext = chacha20poly1305(key, ZERO_NONCE).encrypt(noteToPlaintext(note));
  return { ephemeralPub, viewTag, ciphertext };
}

export function decryptNote(recipientEncSecret: Uint8Array, enc: EncryptedNote): Note | null {
  const shared = x25519.getSharedSecret(recipientEncSecret, enc.ephemeralPub);
  const { key } = deriveAead(shared);
  try {
    const pt = chacha20poly1305(key, ZERO_NONCE).decrypt(enc.ciphertext);
    return plaintextToNote(pt);
  } catch {
    return null; // fail closed (wrong key / tampered / view-tag false positive)
  }
}

/** view tag a recipient would compute for an ephemeral pubkey (scan fast path). */
export function computeViewTag(recipientEncSecret: Uint8Array, ephemeralPub: Uint8Array): number {
  return deriveAead(x25519.getSharedSecret(recipientEncSecret, ephemeralPub))[
    "viewTag" as keyof ReturnType<typeof deriveAead>
  ] as unknown as number;
}

export function encWire(enc: EncryptedNote): Uint8Array {
  return new Uint8Array([...enc.ephemeralPub, ...enc.ciphertext]);
}
export function encFromWire(wire: Uint8Array, viewTag: number): EncryptedNote | null {
  if (wire.length < 32) return null;
  return { ephemeralPub: wire.slice(0, 32), viewTag, ciphertext: wire.slice(32) };
}

// ── extDataHash (INTERFACES §4): keccak256 of the canonical buffer, mod r ──

export interface ExtData {
  recipient: Uint8Array; // 32
  relayer: Uint8Array; // 32
  fee: bigint; // u128
  ciphertexts: [Uint8Array, Uint8Array];
  viewTags: [number, number];
  /** Phase-2 settlement counterparty (Stellar G-address strkey). Bound into the
   *  hash via its ASCII bytes so a withdraw recipient can't be redirected. */
  settlementAddress: string;
}

function u32be(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}
function u128be(v: bigint): Uint8Array {
  const out = new Uint8Array(16);
  let x = v;
  for (let i = 15; i >= 0; i--) { out[i] = Number(x & 0xffn); x >>= 8n; }
  return out;
}

export function extDataHash(ext: ExtData): bigint {
  const parts: number[] = [];
  const push = (a: Uint8Array) => { for (const b of a) parts.push(b); };
  push(ext.recipient);
  push(ext.relayer);
  push(u128be(ext.fee));
  for (const ct of ext.ciphertexts) { push(u32be(ct.length)); push(ct); }
  parts.push(ext.viewTags[0] & 0xff);
  parts.push(ext.viewTags[1] & 0xff);
  // settlement address strkey: u32-be length || ASCII bytes
  const addr = new TextEncoder().encode(ext.settlementAddress);
  push(u32be(addr.length));
  push(addr);
  const digestHex = keccak256(new Uint8Array(parts));
  return BigInt("0x" + digestHex) % R;
}
