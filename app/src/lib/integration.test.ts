// Integration smoke test (node, no browser): build a real deposit witness with
// witness.ts, prove it with snarkjs against the REAL circuit artifacts, verify
// it, and check proof.ts produces the contract's byte layout. Proves the whole
// off-chain pipeline is correct without a live submission.
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as snarkjs from "snarkjs";
import { initCrypto, deriveKeys, fieldToBytes } from "./crypto";
import { ClientMerkleTree } from "./merkleTree";
import { buildDeposit } from "./witness";
import { proofToBytes, publicSignalsToBytes } from "./proof";

const here = dirname(fileURLToPath(import.meta.url));
const CIRCUIT = join(here, "../../public/circuit");
const WASM = join(CIRCUIT, "transaction.wasm");
const ZKEY = join(CIRCUIT, "transaction.zkey");
const VKEY = JSON.parse(readFileSync(join(CIRCUIT, "verification_key.json"), "utf8"));

beforeAll(async () => { await initCrypto(); });

describe("deposit witness → real proof → verify + format", () => {
  it("proves and verifies, bytes are 64/128/64 & 8×32", async () => {
    const keys = deriveKeys(fieldToBytes(123456789n));
    const tree = new ClientMerkleTree();
    const bundle = buildDeposit({
      root: tree.root(),
      sk: keys.spendKey,
      selfPub: keys.publicKey,
      selfEncPub: keys.encPublic,
      amount: 2500n,
      currencyId: 0,
      settlementAddress: "GAKON75EXHETR5EAUTZLO5S7YSYMUXV4VRAPYWHHD4AG2QVSBAM3CJLM",
    });

    // value conservation: publicAmount(2500) == out0(2500) + out1(0)
    expect(bundle.publicSignals[1]).toBe("2500");
    // currencyId is public signal [7]
    expect(bundle.publicSignals[7]).toBe("0");

    const { proof, publicSignals } = await snarkjs.groth16.fullProve(bundle.input, WASM, ZKEY);
    const ok = await snarkjs.groth16.verify(VKEY, publicSignals, proof);
    expect(ok).toBe(true);

    // public signals from the proof must equal what witness.ts predicted
    expect(publicSignals).toEqual(bundle.publicSignals);

    const pb = proofToBytes(proof);
    expect(pb.a.length).toBe(64);
    expect(pb.b.length).toBe(128);
    expect(pb.c.length).toBe(64);
    const psb = publicSignalsToBytes(publicSignals);
    expect(psb.length).toBe(8);
    expect(psb.every((x) => x.length === 32)).toBe(true);
  }, 60000);
});
