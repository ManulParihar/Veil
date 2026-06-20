import { beforeAll, describe, expect, it } from "vitest";
import { commitment, deriveKeys, fieldToBytes, initCrypto, type Note } from "./crypto";
import { ClientMerkleTree } from "./merkleTree";
import { DEFAULT_CURRENCY_ID } from "./currencies";
import { noteKey, selectSpendInputs, spendSelectionError } from "./spendSelection";
import type { StoredNote } from "./types";

beforeAll(async () => { await initCrypto(); });

const stored = (note: Note, leafIndex: number | null): StoredNote => ({
  note,
  leafIndex,
  spent: false,
  createdAt: 1,
});

describe("spend input selection", () => {
  it("combines 9 + 5 when spending 10 and leaves one change note", () => {
    const keys = deriveKeys(fieldToBytes(424242n));
    const tree = new ClientMerkleTree();
    const note9: Note = { amount: 9n, currencyId: DEFAULT_CURRENCY_ID, pubkey: keys.publicKey, blinding: 90n };
    const note5: Note = { amount: 5n, currencyId: DEFAULT_CURRENCY_ID, pubkey: keys.publicKey, blinding: 50n };
    const notes = [
      stored(note9, tree.insert(commitment(note9))),
      stored(note5, tree.insert(commitment(note5))),
    ];

    const result = selectSpendInputs(notes, tree, keys.publicKey, DEFAULT_CURRENCY_ID, 10n);

    expect(result.totalSpendable).toBe(14n);
    expect(result.selected?.inputs).toHaveLength(2);
    expect(result.selected?.total).toBe(14n);
    expect(result.selected?.change).toBe(4n);

    const spentKeys = new Set(result.selected!.notes.map((n) => noteKey(n.note)));
    const updated = notes.map((n) => (spentKeys.has(noteKey(n.note)) ? { ...n, spent: true } : n));
    const withChange = [
      ...updated,
      stored({ amount: result.selected!.change, currencyId: DEFAULT_CURRENCY_ID, pubkey: keys.publicKey, blinding: 4n }, 2),
    ];

    expect(withChange.filter((n) => n.spent)).toHaveLength(2);
    expect(withChange.filter((n) => !n.spent)).toHaveLength(1);
    expect(withChange.filter((n) => !n.spent).reduce((sum, n) => sum + n.note.amount, 0n)).toBe(4n);
  });

  it("chooses the smallest-change one-or-two note combination", () => {
    const keys = deriveKeys(fieldToBytes(123n));
    const tree = new ClientMerkleTree();
    const note12: Note = { amount: 12n, currencyId: DEFAULT_CURRENCY_ID, pubkey: keys.publicKey, blinding: 12n };
    const note9: Note = { amount: 9n, currencyId: DEFAULT_CURRENCY_ID, pubkey: keys.publicKey, blinding: 9n };
    const note5: Note = { amount: 5n, currencyId: DEFAULT_CURRENCY_ID, pubkey: keys.publicKey, blinding: 5n };
    const notes = [note12, note9, note5].map((note) => stored(note, tree.insert(commitment(note))));

    const result = selectSpendInputs(notes, tree, keys.publicKey, DEFAULT_CURRENCY_ID, 10n);

    expect(result.selected?.inputs).toHaveLength(1);
    expect(result.selected?.total).toBe(12n);
    expect(result.selected?.change).toBe(2n);
  });

  it("reports split-across-too-many-notes when balance is enough but no pair covers it", () => {
    const keys = deriveKeys(fieldToBytes(321n));
    const tree = new ClientMerkleTree();
    const notes = [4n, 4n, 4n].map((amount, i) => {
      const note: Note = { amount, currencyId: DEFAULT_CURRENCY_ID, pubkey: keys.publicKey, blinding: BigInt(i + 1) };
      return stored(note, tree.insert(commitment(note)));
    });

    const result = selectSpendInputs(notes, tree, keys.publicKey, DEFAULT_CURRENCY_ID, 10n);

    expect(result.totalSpendable).toBe(12n);
    expect(result.selected).toBeNull();
    expect(spendSelectionError(result.totalSpendable, 10n).message).toContain("at most two notes");
  });

  it("excludes invalid quarantined notes but keeps valid persisted notes spendable", () => {
    const keys = deriveKeys(fieldToBytes(999n));
    const tree = new ClientMerkleTree();
    const valid: Note = { amount: 5n, currencyId: DEFAULT_CURRENCY_ID, pubkey: keys.publicKey, blinding: 5n };
    const invalid: Note = { amount: 50n, currencyId: DEFAULT_CURRENCY_ID, pubkey: keys.publicKey, blinding: 50n };
    const notes = [
      stored(valid, tree.insert(commitment(valid))),
      { ...stored(invalid, tree.insert(commitment(invalid))), invalidReason: "note commitment does not match this leaf" },
    ];

    const result = selectSpendInputs(notes, tree, keys.publicKey, DEFAULT_CURRENCY_ID, 5n);

    expect(result.totalSpendable).toBe(5n);
    expect(result.selected?.inputs).toHaveLength(1);
    expect(result.selected?.inputs[0].note).toBe(valid);
  });
});
