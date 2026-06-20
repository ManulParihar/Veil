import { commitment, type Note } from "./crypto";
import { ClientMerkleTree } from "./merkleTree";
import type { StoredNote } from "./types";
import type { SpendInput } from "./witness";

export interface SelectedSpend {
  notes: StoredNote[];
  inputs: SpendInput[];
  total: bigint;
  change: bigint;
}

export interface SpendSelectionResult {
  selected: SelectedSpend | null;
  totalSpendable: bigint;
}

interface Candidate {
  stored: StoredNote;
  input: SpendInput;
  amount: bigint;
}

export function selectSpendInputs(
  notes: StoredNote[],
  tree: ClientMerkleTree,
  ownerPubkey: bigint,
  currencyId: number,
  amount: bigint
): SpendSelectionResult {
  const candidates: Candidate[] = [];

  for (const stored of notes) {
    if (stored.spent) continue;
    if (stored.invalidReason) continue;
    if (stored.note.pubkey !== ownerPubkey) continue;
    if (stored.note.currencyId !== currencyId) continue;
    if (stored.leafIndex == null) continue;

    const leafIndex = tree.indexOf(commitment(stored.note));
    if (leafIndex < 0) continue;

    candidates.push({
      stored,
      input: { note: stored.note, leafIndex },
      amount: stored.note.amount,
    });
  }

  const totalSpendable = candidates.reduce((sum, c) => sum + c.amount, 0n);
  let best: SelectedSpend | null = null;

  const consider = (combo: Candidate[]) => {
    const total = combo.reduce((sum, c) => sum + c.amount, 0n);
    if (total < amount) return;

    const change = total - amount;
    if (
      !best ||
      change < best.change ||
      (change === best.change && combo.length < best.inputs.length)
    ) {
      best = {
        notes: combo.map((c) => c.stored),
        inputs: combo.map((c) => c.input),
        total,
        change,
      };
    }
  };

  for (const candidate of candidates) consider([candidate]);
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      consider([candidates[i], candidates[j]]);
    }
  }

  return { selected: best, totalSpendable };
}

export function spendSelectionError(totalSpendable: bigint, amount: bigint): Error {
  if (totalSpendable < amount) {
    return new Error("insufficient shielded balance for this asset");
  }
  return new Error(
    "amount is split across more than two notes; this circuit can spend at most two notes per transaction"
  );
}

export function noteKey(note: Note): string {
  return commitment(note).toString();
}
