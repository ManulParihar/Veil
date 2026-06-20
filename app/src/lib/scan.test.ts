import { beforeAll, describe, expect, it } from "vitest";
import {
  commitment, deriveKeys, encryptNote, encWire, fieldToBytes, initCrypto,
  type Note,
} from "./crypto";
import { scanEvents } from "./scan";
import { DEFAULT_CURRENCY_ID } from "./currencies";
import type { CommitmentEvent } from "./chain";

beforeAll(async () => { await initCrypto(); });

const eventFor = (note: Note, recipientEncPub: Uint8Array, leafIndex = 0): CommitmentEvent => {
  const enc = encryptNote(recipientEncPub, note);
  return {
    commitment: fieldToBytes(commitment(note)),
    leafIndex,
    ciphertext: encWire(enc),
    viewTag: enc.viewTag,
    ledger: 1,
  };
};

describe("scanEvents", () => {
  it("rejects a decryptable note when its plaintext commitment does not match the event", () => {
    const keys = deriveKeys(fieldToBytes(100n));
    const note: Note = { amount: 5n, currencyId: DEFAULT_CURRENCY_ID, pubkey: keys.publicKey, blinding: 5n };
    const ev = eventFor(note, keys.encPublic);
    const tampered: CommitmentEvent = {
      ...ev,
      commitment: fieldToBytes(commitment({ ...note, blinding: 6n })),
    };

    expect(scanEvents(keys, [tampered])).toEqual([]);
  });

  it("rejects a decryptable note owned by a different spend pubkey", () => {
    const keys = deriveKeys(fieldToBytes(100n));
    const other = deriveKeys(fieldToBytes(200n));
    const note: Note = { amount: 5n, currencyId: DEFAULT_CURRENCY_ID, pubkey: other.publicKey, blinding: 5n };

    expect(scanEvents(keys, [eventFor(note, keys.encPublic)])).toEqual([]);
  });

  it("accepts a decryptable note that matches the event commitment and owner", () => {
    const keys = deriveKeys(fieldToBytes(100n));
    const note: Note = { amount: 5n, currencyId: DEFAULT_CURRENCY_ID, pubkey: keys.publicKey, blinding: 5n };

    expect(scanEvents(keys, [eventFor(note, keys.encPublic, 7)])).toEqual([{ note, leafIndex: 7 }]);
  });
});
