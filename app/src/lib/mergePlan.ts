// Timed "Merge privately" plans. When spending an amount needs combining many
// notes (>4, i.e. ≥2 merge rounds), the user can choose to consolidate over time
// instead of in one burst: this module persists a one-shot, self-targeted plan
// that merges the notes a pair at a time, spaced at RANDOMIZED intervals landing
// by a user-chosen deadline. A poller (useMergePlanner) fires the due step via
// the wallet's mergeNotes while the app is open; there is no custodial backend.
//
// Privacy goal: break the back-to-back burst fingerprint (many self-sends in
// quick succession on one root). It does NOT hide that the final MAX output is
// funded by all the notes — that linkage is inherent to spending everything at
// once. CONSOLIDATE ONLY: the plan never withdraws; the user returns later and
// withdraws the now-≤2-note balance in one normal tx.
//
// Plans persist to localStorage, partitioned by identity (seedHex), so each
// shielded identity keeps its own pending consolidations (and they resume after
// a reload). Pure logic + a thin storage wrapper, mirroring schedule.ts.

const STORE_KEY = "poof-merge-plans";

/** Minimum spacing between two merges — enough for the previous one to settle and
 *  be indexed before the next spend, and to keep "randomized" from collapsing to
 *  back-to-back. The deadline window is stretched to fit this if the user picks a
 *  very short horizon for the number of merges required. */
export const MERGE_MIN_GAP_MS = 20_000;

/** Session-key lifetime for an immediate ("Do it anyways") merge-then-spend.
 *  Generous enough to cover a back-to-back burst of merges plus the trailing
 *  send/withdraw; the throwaway key holds only fee dust and expires on its own. */
export const IMMEDIATE_MERGE_TTL_MS = 10 * 60_000;

export interface MergePlan {
  id: string;
  currencyId: number;
  /** target amount to make spendable, base units as a decimal string (bigint-safe). */
  amountBase: string;
  /** human label for display (e.g. "1,234 VUSD"). */
  label: string;
  /** epoch ms the user wants the amount ready by. */
  deadline: number;
  /** planned fire-times (epoch ms), ascending; length = balanced-tree ROUNDS.
   *  Each fire-time runs one whole round (all of that round's pair-merges). */
  schedule: number[];
  /** rounds fired so far (index into `schedule`). */
  fired: number;
  /** total pair-merges across all rounds (= max(0, k - 2)); the progress denominator. */
  totalMerges: number;
  /** pair-merges completed so far (the progress numerator); updates per merge. */
  merged: number;
  /** false once complete (or cancelled). */
  active: boolean;
  createdAt: number;
  lastRun?: number;
  lastStatus?: "ok" | "error";
  lastError?: string;
  /** true when a round is due but can't fire silently (wallet identity with no/
   *  expired delegation), so it's deferred rather than prompting in the background.
   *  Cleared once a step fires. Surfaced in the UI so the user can re-authorize. */
  paused?: boolean;
}

// ── persistence (per-identity) ──

type Store = Record<string, MergePlan[]>;

function readStore(): Store {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" ? (obj as Store) : {};
  } catch {
    return {};
  }
}

function writeStore(store: Store): void {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch { /* quota / unavailable */ }
}

export function loadMergePlans(seedHex: string): MergePlan[] {
  return readStore()[seedHex] ?? [];
}

export function saveMergePlans(seedHex: string, list: MergePlan[]): void {
  const store = readStore();
  store[seedHex] = list;
  writeStore(store);
}

const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

// ── scheduling (pure) ──

/**
 * Spread `steps` merges across `(now, deadline]` with randomized gaps. One random
 * point per even segment gives non-uniform spacing (breaks the burst pattern)
 * while keeping the last step near the deadline. The window is stretched if it's
 * too short to give each merge room to settle (`MERGE_MIN_GAP_MS`).
 */
export function buildSchedule(
  steps: number,
  now: number,
  deadline: number,
  minGapMs = MERGE_MIN_GAP_MS
): number[] {
  if (steps <= 0) return [];
  const span = Math.max(deadline - now, steps * minGapMs);
  const seg = span / steps;
  const times: number[] = [];
  let prev = now;
  for (let i = 0; i < steps; i++) {
    const lo = now + i * seg;
    const hi = now + (i + 1) * seg;
    let t = lo + Math.random() * (hi - lo);
    if (t < prev + minGapMs) t = prev + minGapMs; // never closer than the settle gap
    times.push(Math.round(t));
    prev = t;
  }
  return times;
}

export interface NewMergePlan {
  currencyId: number;
  amountBase: bigint;
  label: string;
  /** epoch ms the user wants the amount ready by. */
  deadline: number;
  /** balanced-tree rounds required (= ceil(log2(k)) for k > 2). Each scheduled
   *  slot fires one full round (all pairs in that round at once). */
  rounds: number;
  /** total pair-merges across all rounds (= max(0, k - 2)); the progress denominator. */
  totalMerges: number;
}

export function makeMergePlan(input: NewMergePlan, now = Date.now()): MergePlan {
  return {
    id: uid(),
    currencyId: input.currencyId,
    amountBase: input.amountBase.toString(),
    label: input.label,
    deadline: input.deadline,
    schedule: buildSchedule(input.rounds, now, input.deadline),
    fired: 0,
    totalMerges: input.totalMerges,
    merged: 0,
    active: true,
    createdAt: now,
  };
}

/** True when the plan's next merge is due to fire. */
export function stepDue(p: MergePlan, now = Date.now()): boolean {
  return p.active && p.fired < p.schedule.length && now >= p.schedule[p.fired];
}

export function dueMergePlans(list: MergePlan[], now = Date.now()): MergePlan[] {
  return list.filter((p) => stepDue(p, now));
}

/** Progress as a {done,total} pair of PAIR-MERGES for display — updates as each
 *  merge within a round lands, not just per round. Falls back to round counts for
 *  plans persisted before merge-level tracking existed. */
export function mergeProgress(p: MergePlan): { done: number; total: number } {
  const total = p.totalMerges ?? p.schedule.length;
  const done = Math.min(p.merged ?? p.fired, total);
  return { done, total };
}

/** Next fire-time (epoch ms) the plan is waiting on, or null when complete. */
export function nextFireAt(p: MergePlan): number | null {
  return p.fired < p.schedule.length ? p.schedule[p.fired] : null;
}
