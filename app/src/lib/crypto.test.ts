// THE browser crypto gate: assert TS crypto is bit-identical to veil-crypto /
// the circuit, against the pinned vectors (INTERFACES.md §0).
import { describe, it, expect, beforeAll } from "vitest";
import {
  initCrypto, hash2, hash3, deriveKeys, commitment, nullifier, Note,
  encryptNote, decryptNote, computeViewTag, encWire, encFromWire,
  extDataHash, fieldToBytes,
} from "./crypto";

beforeAll(async () => { await initCrypto(); });

describe("Poseidon == circomlib pinned vectors", () => {
  it("Poseidon(1,2)", () => {
    expect(hash2(1n, 2n).toString()).toBe(
      "7853200120776062878684798364095072458815029376092732009249414926327459813530"
    );
  });
  it("Poseidon(1,2,3)", () => {
    expect(hash3(1n, 2n, 3n).toString()).toBe(
      "6542985608222806190361240322586112750744169038454362455181422643027100751666"
    );
  });
});

describe("note vectors (sk=7, amount=100, blinding=42, pathIndex=3)", () => {
  it("commitment and nullifier", async () => {
    const { hash1 } = await import("./crypto");
    const sk = 7n;
    const pk = hash1(sk);
    expect(pk.toString()).toBe(
      "7061949393491957813657776856458368574501817871421526214197139795307327923534"
    );
    const note: Note = { amount: 100n, pubkey: pk, blinding: 42n };
    expect(commitment(note).toString()).toBe(
      "9393485090685125340160626343171654838660902907959359341345939329381592242612"
    );
    expect(nullifier(note, sk, 3n).toString()).toBe(
      "15859786158883198570120416352149778089550541078065235834061119830959898607558"
    );
  });
});

describe("encryption round-trip + fail-closed", () => {
  it("encrypt → decrypt, wrong key fails, view tag matches", () => {
    const recipient = deriveKeys(fieldToBytes(11n));
    const attacker = deriveKeys(fieldToBytes(99n));
    const note: Note = { amount: 12345n, pubkey: 99n, blinding: 7n };
    const enc = encryptNote(recipient.encPublic, note);
    expect(enc.ciphertext.length).toBe(72 + 16);
    const dec = decryptNote(recipient.encSecret, enc);
    expect(dec).not.toBeNull();
    expect(dec!.amount).toBe(12345n);
    expect(decryptNote(attacker.encSecret, enc)).toBeNull();
    expect(computeViewTag(recipient.encSecret, enc.ephemeralPub)).toBe(enc.viewTag);
    const wire = encWire(enc);
    const back = encFromWire(wire, enc.viewTag)!;
    expect(decryptNote(recipient.encSecret, back)!.amount).toBe(12345n);
  });
});

describe("extDataHash determinism + sensitivity", () => {
  const SETTLE_G = "GAKON75EXHETR5EAUTZLO5S7YSYMUXV4VRAPYWHHD4AG2QVSBAM3CJLM";
  const emptyBase = () => ({
    recipient: new Uint8Array(32), relayer: new Uint8Array(32), fee: 0n,
    ciphertexts: [new Uint8Array(), new Uint8Array()] as [Uint8Array, Uint8Array],
    viewTags: [0, 0] as [number, number], settlementAddress: SETTLE_G,
  });

  it("changes when recipient changes / settlement address changes", () => {
    const base = emptyBase();
    expect(extDataHash(base)).toBe(extDataHash(base));
    expect(extDataHash({ ...base, recipient: fieldToBytes(5n) })).not.toBe(extDataHash(base));
    expect(extDataHash({ ...base, settlementAddress: "GBOTHERADDRESS" })).not.toBe(extDataHash(base));
  });

  it("matches the on-chain empty-ExtData hash (with settlement binding)", () => {
    // value computed by the contract / gen_transact_fixture.js for the SETTLE_G case
    expect(extDataHash(emptyBase()).toString()).toBe(
      "19770379959592559262147413031436042315599261732788161869224785290507777222292"
    );
  });
});
