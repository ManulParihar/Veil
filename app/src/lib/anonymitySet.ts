// Anonymity-set math — turns the pool's weakness ("small pools mean small
// anonymity sets") into a number the user can act on. Two ideas:
//
//   • Set size   — how many commitments are in the pool. The more there are, the
//     more deposits your spend could plausibly be unwinding. Tornado-style
//     privacy is exactly the size of this crowd.
//   • Note freshness ("buried-ness") — how many commitments were inserted AFTER a
//     note you're about to spend. A note you deposited 1 block ago, with nothing
//     since, is trivially timing-linked to its deposit. Waiting buries it.
//
// Everything here is derived from `nextLeafIndex` (the pool's leaf count) and a
// note's own `leafIndex` — both already in the wallet, no extra chain calls.

import type { StoredNote } from "./types";

export type AnonLevel = "danger" | "warn" | "good" | "strong";

export interface AnonymityAssessment {
  /** commitments currently in the pool. */
  setSize: number;
  setLevel: AnonLevel;
  /** least-buried candidate note: commitments inserted after it (null = no notes). */
  freshest: number | null;
  freshestLevel: AnonLevel;
  /** overall = the weaker of the two signals. */
  overall: AnonLevel;
  message: string;
}

const ORDER: Record<AnonLevel, number> = { danger: 0, warn: 1, good: 2, strong: 3 };
const weaker = (a: AnonLevel, b: AnonLevel): AnonLevel => (ORDER[a] <= ORDER[b] ? a : b);

export function setSizeLevel(size: number): AnonLevel {
  if (size < 10) return "danger";
  if (size < 50) return "warn";
  if (size < 200) return "good";
  return "strong";
}

/** Commitments inserted after `leafIndex`. Larger = more deeply buried. */
export function depositsAfter(leafIndex: number, nextLeafIndex: number): number {
  return Math.max(0, nextLeafIndex - leafIndex - 1);
}

export function freshnessLevel(after: number): AnonLevel {
  if (after < 2) return "danger";
  if (after < 8) return "warn";
  if (after < 32) return "good";
  return "strong";
}

const SET_MSG: Record<AnonLevel, string> = {
  danger: "Tiny pool — your spend stands out. Privacy grows as the pool fills.",
  warn: "Modest anonymity set — usable, but bigger is better.",
  good: "Healthy anonymity set.",
  strong: "Large anonymity set — strong cover.",
};

const FRESH_MSG: Record<AnonLevel, string> = {
  danger: "These funds were just deposited — spending now is easy to timing-link. Consider waiting.",
  warn: "Recently deposited — a short wait buries them further.",
  good: "Well buried among later deposits.",
  strong: "Deeply buried — timing correlation is hard.",
};

/**
 * Assess the privacy of spending `currencyId` right now. `candidates` should be
 * the unspent notes of that currency (with on-chain leaf positions); the freshest
 * (least buried) one dominates, since that's what an analyst would target.
 */
export function assessSpend(
  candidates: StoredNote[],
  currencyId: number,
  nextLeafIndex: number | null
): AnonymityAssessment {
  const size = nextLeafIndex ?? 0;
  const setLevel = setSizeLevel(size);

  const spendable = candidates.filter(
    (n) => !n.spent && !n.invalidReason && n.note.currencyId === currencyId && n.leafIndex != null
  );
  let freshest: number | null = null;
  for (const n of spendable) {
    const after = depositsAfter(n.leafIndex as number, size);
    freshest = freshest === null ? after : Math.min(freshest, after);
  }
  const freshestLevel = freshest === null ? "good" : freshnessLevel(freshest);
  const overall = freshest === null ? setLevel : weaker(setLevel, freshestLevel);

  // surface whichever signal is the weaker link
  const message =
    freshest !== null && ORDER[freshestLevel] < ORDER[setLevel]
      ? FRESH_MSG[freshestLevel]
      : SET_MSG[setLevel];

  return { setSize: size, setLevel, freshest, freshestLevel, overall, message };
}

export const LEVEL_LABEL: Record<AnonLevel, string> = {
  danger: "Weak",
  warn: "Fair",
  good: "Good",
  strong: "Strong",
};
