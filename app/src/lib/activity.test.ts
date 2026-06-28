import { beforeAll, describe, expect, it } from "vitest";
import {
  commitment, deriveKeys, encryptNote, encWire, fieldToBytes, initCrypto,
  nullifier as noteNullifier, type Keys, type Note,
} from "./crypto";
import { deriveActivity } from "./activity";
import { DEFAULT_CURRENCY_ID as CID } from "./currencies";
import type { CommitmentEvent, NullifierEvent } from "./chain";

beforeAll(async () => { await initCrypto(); });

const me = () => deriveKeys(fieldToBytes(100n));
const other = () => deriveKeys(fieldToBytes(200n));

function note(amount: bigint, owner: Keys, blinding: bigint): Note {
  return { amount, currencyId: CID, pubkey: owner.publicKey, blinding };
}

// A NewCommit event: encrypt the note to `encPub`, tagged with a tx hash + time.
function commit(
  n: Note, encPub: Uint8Array, leafIndex: number, txHash: string, time = 1_000,
): CommitmentEvent {
  const enc = encryptNote(encPub, n);
  return {
    commitment: fieldToBytes(commitment(n)),
    leafIndex, ciphertext: encWire(enc), viewTag: enc.viewTag,
    ledger: 1, txHash, ledgerCloseTime: time,
  };
}

// A Nullifier event for spending `n` (owned at `leafIndex`) in tx `txHash`.
function nullify(n: Note, owner: Keys, leafIndex: number, txHash: string): NullifierEvent {
  return {
    nf: fieldToBytes(noteNullifier(n, owner.spendKey, BigInt(leafIndex))),
    ledger: 1, txHash,
  };
}

describe("deriveActivity classification", () => {
  it("labels an incoming payment (1 of our outputs, no spend) as receive", () => {
    const keys = me();
    const recv = note(5n, keys, 1n);
    const senderChange = note(7n, other(), 2n); // to someone else
    const acts = deriveActivity(
      keys,
      [commit(recv, keys.encPublic, 0, "rx"), commit(senderChange, other().encPublic, 1, "rx")],
      [],
    );
    expect(acts).toHaveLength(1);
    expect(acts[0]).toMatchObject({ kind: "receive", amount: 5n, txHash: "rx", time: 1000 });
  });

  it("labels a self-funded mint (2 of our outputs, no spend) as deposit", () => {
    const keys = me();
    const acts = deriveActivity(
      keys,
      [commit(note(10n, keys, 1n), keys.encPublic, 0, "dp"),
       commit(note(0n, keys, 2n), keys.encPublic, 1, "dp")], // zero pad
      [],
    );
    expect(acts).toHaveLength(1);
    expect(acts[0]).toMatchObject({ kind: "deposit", amount: 10n });
  });

  it("labels a spend with a foreign output as a transfer sent (amount = in − change)", () => {
    const keys = me();
    const owned = note(8n, keys, 1n);                 // received earlier at leaf 0
    const recipient = note(3n, other(), 9n);          // goes to someone else
    const change = note(5n, keys, 2n);                // back to us
    const acts = deriveActivity(
      keys,
      [
        commit(owned, keys.encPublic, 0, "rx"),
        commit(recipient, other().encPublic, 1, "tx"),
        commit(change, keys.encPublic, 2, "tx"),
      ],
      [nullify(owned, keys, 0, "tx")],
    );
    const sent = acts.find((a) => a.txHash === "tx");
    expect(sent).toMatchObject({ kind: "transfer", amount: 3n });
  });

  it("labels a spend whose funds leave (Σout < Σin) as withdraw", () => {
    const keys = me();
    const owned = note(8n, keys, 1n);
    const change = note(2n, keys, 2n);
    const acts = deriveActivity(
      keys,
      [
        commit(owned, keys.encPublic, 0, "rx"),
        commit(change, keys.encPublic, 1, "tx"),
        commit(note(0n, keys, 3n), keys.encPublic, 2, "tx"), // zero pad
      ],
      [nullify(owned, keys, 0, "tx")],
    );
    expect(acts.find((a) => a.txHash === "tx")).toMatchObject({ kind: "withdraw", amount: 6n });
  });

  it("labels a self-transfer (decoy: both outputs ours, funds preserved) as self", () => {
    const keys = me();
    const owned = note(8n, keys, 1n);
    const acts = deriveActivity(
      keys,
      [
        commit(owned, keys.encPublic, 0, "rx"),
        commit(note(5n, keys, 2n), keys.encPublic, 1, "tx"),
        commit(note(3n, keys, 3n), keys.encPublic, 2, "tx"),
      ],
      [nullify(owned, keys, 0, "tx")],
    );
    expect(acts.find((a) => a.txHash === "tx")).toMatchObject({ kind: "self", amount: 5n });
  });

  it("does not reclassify a withdraw (Σout < Σin) as self", () => {
    const keys = me();
    const owned = note(8n, keys, 1n);
    const change = note(2n, keys, 2n);
    const acts = deriveActivity(
      keys,
      [
        commit(owned, keys.encPublic, 0, "rx"),
        commit(change, keys.encPublic, 1, "tx"),
        commit(note(0n, keys, 3n), keys.encPublic, 2, "tx"), // zero pad
      ],
      [nullify(owned, keys, 0, "tx")],
    );
    expect(acts.find((a) => a.txHash === "tx")).toMatchObject({ kind: "withdraw", amount: 6n });
  });

  it("ignores transactions that don't touch us", () => {
    const keys = me();
    const acts = deriveActivity(
      keys,
      [commit(note(5n, other(), 1n), other().encPublic, 0, "foreign")],
      [],
    );
    expect(acts).toEqual([]);
  });
});
