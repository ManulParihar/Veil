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

/** Gather this identity's spendable notes for one asset, each resolved to its
 *  current on-chain leaf index. Shared by `selectSpendInputs` (final ≤2-note
 *  spend) and `planConsolidation` (multi-note merge planning) so both judge
 *  spendability by the same rules. */
function gatherCandidates(
  notes: StoredNote[],
  tree: ClientMerkleTree,
  ownerPubkey: bigint,
  currencyId: number
): Candidate[] {
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
  return candidates;
}

export function selectSpendInputs(
  notes: StoredNote[],
  tree: ClientMerkleTree,
  ownerPubkey: bigint,
  currencyId: number,
  amount: bigint
): SpendSelectionResult {
  const candidates = gatherCandidates(notes, tree, ownerPubkey, currencyId);

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

/** A merge consolidation plan: how many of this identity's notes must be combined
 *  (and over how many balanced-tree rounds) before `amount` can be spent in a
 *  single ≤2-note transaction. The circuit is 2-in/2-out, so any amount whose
 *  smallest covering set needs ≥3 notes is unspendable until those notes are
 *  merged (each merge = a self-transfer collapsing 2 notes → 1). */
export interface ConsolidationPlan {
  /** k: size of the smallest (largest-first) covering set for `amount`. */
  noteCount: number;
  /** Balanced-tree rounds to reduce the covering set to ≤2 notes (0 when k ≤ 2).
   *  Used for the UI threshold: 0 = spend directly, 1 = silent merge,
   *  ≥2 = warn (merging this many notes links them to one output). */
  rounds: number;
  /** S: total merge steps across all rounds (= max(0, k - 2)). Each step is one
   *  2-note self-transfer; the timed planner paces this many merges to a deadline. */
  totalMerges: number;
  /** The covering notes, largest-first — the inputs the executor merges. */
  coveringNotes: StoredNote[];
}

/** Pure: decide the merge strategy for spending `amount` of one asset. Returns a
 *  plan (null when the balance can't cover `amount`, so the caller falls through
 *  to the normal spend which throws the right insufficient/lag error). */
export function planConsolidation(
  notes: StoredNote[],
  tree: ClientMerkleTree,
  ownerPubkey: bigint,
  currencyId: number,
  amount: bigint
): { plan: ConsolidationPlan | null; totalSpendable: bigint } {
  const candidates = gatherCandidates(notes, tree, ownerPubkey, currencyId);
  const totalSpendable = candidates.reduce((sum, c) => sum + c.amount, 0n);
  if (amount <= 0n || totalSpendable < amount) return { plan: null, totalSpendable };

  // Largest-first covering set minimizes the note count k (and so the merge work).
  const sorted = [...candidates].sort((a, b) =>
    a.amount < b.amount ? 1 : a.amount > b.amount ? -1 : 0
  );
  const covering: Candidate[] = [];
  let sum = 0n;
  for (const c of sorted) {
    covering.push(c);
    sum += c.amount;
    if (sum >= amount) break;
  }
  const k = covering.length;

  // Rounds to reduce k notes to ≤2 by ceil-halving (each round merges disjoint
  // pairs in parallel against one root): k=3→1, k=4→1, k=5→2, k=8→2 …
  let rounds = 0;
  let count = k;
  while (count > 2) {
    count = Math.ceil(count / 2);
    rounds++;
  }

  return {
    plan: {
      noteCount: k,
      rounds,
      totalMerges: Math.max(0, k - 2),
      coveringNotes: covering.map((c) => c.stored),
    },
    totalSpendable,
  };
}
