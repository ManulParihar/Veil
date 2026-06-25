// ScVal encoders for the contract's `transact(proof, public_signals, ext_data)`.
// Mirrors app/src/lib/chain.ts + proof.ts byte-for-byte (Soroban map keys must be
// sorted; the SDK sorts them in `structV`).
import { xdr, nativeToScVal, Address } from "@stellar/stellar-sdk";

export const fromHex = (h: string): Uint8Array => {
  const s = h.startsWith("0x") ? h.slice(2) : h;
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
};

const sym = (s: string) => xdr.ScVal.scvSymbol(s);
const bytesV = (u8: Uint8Array) => xdr.ScVal.scvBytes(Buffer.from(u8));

function structV(obj: Record<string, xdr.ScVal>): xdr.ScVal {
  const entries = Object.keys(obj)
    .sort()
    .map((k) => new xdr.ScMapEntry({ key: sym(k), val: obj[k] }));
  return xdr.ScVal.scvMap(entries);
}

/** Proof bytes as hex strings (a=64, b=128, c=64). */
export interface ProofHex { a: string; b: string; c: string; }

export function proofScVal(p: ProofHex): xdr.ScVal {
  return structV({ a: bytesV(fromHex(p.a)), b: bytesV(fromHex(p.b)), c: bytesV(fromHex(p.c)) });
}

/** 8 public signals, each a 32-byte hex string, in INTERFACES §3 order. */
export function signalsScVal(s: string[]): xdr.ScVal {
  const b = s.map(fromHex);
  return structV({
    root: bytesV(b[0]),
    public_amount: bytesV(b[1]),
    ext_data_hash: bytesV(b[2]),
    nullifier0: bytesV(b[3]),
    nullifier1: bytesV(b[4]),
    commitment0: bytesV(b[5]),
    commitment1: bytesV(b[6]),
    currency_id: bytesV(b[7]),
  });
}

export interface ExtDataHex {
  recipient: string;          // hex32
  relayer: string;            // hex32
  fee: string;                // decimal u128
  ciphertext0: string;        // hex
  ciphertext1: string;        // hex
  viewTag0: number;
  viewTag1: number;
  settlementAddress: string;  // G...
  relayerAddress: string;     // G...
}

export function extScVal(e: ExtDataHex): xdr.ScVal {
  return structV({
    recipient: bytesV(fromHex(e.recipient)),
    relayer: bytesV(fromHex(e.relayer)),
    fee: nativeToScVal(BigInt(e.fee), { type: "u128" }),
    ciphertext0: bytesV(fromHex(e.ciphertext0)),
    ciphertext1: bytesV(fromHex(e.ciphertext1)),
    view_tag0: nativeToScVal(e.viewTag0, { type: "u32" }),
    view_tag1: nativeToScVal(e.viewTag1, { type: "u32" }),
    settlement_address: Address.fromString(e.settlementAddress).toScVal(),
    relayer_address: Address.fromString(e.relayerAddress).toScVal(),
  });
}
