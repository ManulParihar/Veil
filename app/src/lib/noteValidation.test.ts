import { beforeAll, describe, expect, it } from "vitest";
import { commitment, deriveKeys, fieldToBytes, initCrypto, type Note } from "./crypto";
import { DEFAULT_CURRENCY_ID } from "./currencies";
import { validateStoredNotes } from "./noteValidation";
import type { CommitmentEvent } from "./chain";
import type { StoredNote } from "./types";

beforeAll(async () => { await initCrypto(); });

const stored = (note: Note, leafIndex: number, invalidReason?: string): StoredNote => ({
  note,
  leafIndex,
  spent: false,
  createdAt: 1,
  invalidReason,
});

const eventFor = (note: Note, leafIndex: number): CommitmentEvent => ({
  commitment: fieldToBytes(commitment(note)),
  leafIndex,
  ciphertext: new Uint8Array(32),
  viewTag: 0,
  ledger: 1,
});

describe("validateStoredNotes", () => {
  it("keeps valid persisted notes spendable and clears stale invalid reasons", () => {
    const keys = deriveKeys(fieldToBytes(1n));
    const note: Note = { amount: 5n, currencyId: DEFAULT_CURRENCY_ID, pubkey: keys.publicKey, blinding: 5n };

    const [validated] = validateStoredNotes(
      [stored(note, 28, "leaf not found in the synced tree")],
      [eventFor(note, 28)],
      keys.publicKey
    );

    expect(validated.invalidReason).toBeUndefined();
  });

  it("quarantines a note whose commitment does not match its leaf", () => {
    const keys = deriveKeys(fieldToBytes(1n));
    const note: Note = { amount: 5n, currencyId: DEFAULT_CURRENCY_ID, pubkey: keys.publicKey, blinding: 5n };
    const other: Note = { ...note, blinding: 6n };

    const [validated] = validateStoredNotes([stored(note, 28)], [eventFor(other, 28)], keys.publicKey);

    expect(validated.invalidReason).toContain("commitment");
  });

  it("quarantines a decryptable note owned by another spend key", () => {
    const keys = deriveKeys(fieldToBytes(1n));
    const other = deriveKeys(fieldToBytes(2n));
    const note: Note = { amount: 5n, currencyId: DEFAULT_CURRENCY_ID, pubkey: other.publicKey, blinding: 5n };

    const [validated] = validateStoredNotes([stored(note, 28)], [eventFor(note, 28)], keys.publicKey);

    expect(validated.invalidReason).toContain("different spend key");
  });
});
