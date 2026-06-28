// Recurring / scheduled private payments. A schedule is a standing instruction to
// privately send a fixed amount to a shielded address on an interval. While the
// wallet is open, a poller fires anything that's due via the normal `send` path —
// so each run is an ordinary in-browser-proved private transfer; there is no
// custodial backend holding keys or funds.
//
// Schedules persist to localStorage, partitioned by identity (seedHex), so each
// shielded identity keeps its own standing payments. This module is pure logic +
// a thin storage wrapper; the runner takes `send` as a dependency for testability.

const STORE_KEY = "poof-schedules";

export interface ScheduledPayment {
  id: string;
  /** recipient shielded address parts. */
  toPubkey: string;
  toEncPub: string;
  /** human label for the payee (e.g. "Rent", "Alice"). */
  label: string;
  currencyId: number;
  /** amount in the currency's base units, as a decimal string (bigint-safe). */
  amountBase: string;
  /** repeat interval in seconds. */
  intervalSec: number;
  /** next fire time (epoch ms). */
  nextRun: number;
  /** false = paused (kept but not fired). */
  active: boolean;
  createdAt: number;
  lastRun?: number;
  lastStatus?: "success" | "error";
  lastError?: string;
  /** count of successful runs. */
  runs: number;
}

export interface IntervalPreset { id: string; label: string; sec: number; }

export const INTERVALS: IntervalPreset[] = [
  { id: "1m", label: "Every minute (demo)", sec: 60 },
  { id: "1h", label: "Hourly", sec: 3600 },
  { id: "1d", label: "Daily", sec: 86_400 },
  { id: "1w", label: "Weekly", sec: 604_800 },
];

// ── persistence (per-identity) ──

type Store = Record<string, ScheduledPayment[]>;

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

export function loadSchedules(seedHex: string): ScheduledPayment[] {
  return readStore()[seedHex] ?? [];
}

export function saveSchedules(seedHex: string, list: ScheduledPayment[]): void {
  const store = readStore();
  store[seedHex] = list;
  writeStore(store);
}

const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

export interface NewSchedule {
  toPubkey: string;
  toEncPub: string;
  label: string;
  currencyId: number;
  amountBase: bigint;
  intervalSec: number;
  /** ms to wait before the first run (default: one interval). */
  firstDelayMs?: number;
}

export function makeSchedule(input: NewSchedule, now = Date.now()): ScheduledPayment {
  const delay = input.firstDelayMs ?? input.intervalSec * 1000;
  return {
    id: uid(),
    toPubkey: input.toPubkey,
    toEncPub: input.toEncPub,
    label: input.label,
    currencyId: input.currencyId,
    amountBase: input.amountBase.toString(),
    intervalSec: input.intervalSec,
    nextRun: now + delay,
    active: true,
    createdAt: now,
    runs: 0,
  };
}

// ── scheduling logic (pure) ──

export function isDue(s: ScheduledPayment, now = Date.now()): boolean {
  return s.active && now >= s.nextRun;
}

export function dueSchedules(list: ScheduledPayment[], now = Date.now()): ScheduledPayment[] {
  return list.filter((s) => isDue(s, now));
}

/** The Demo cadence (every minute). Only schedules on this interval may fire
 *  while a delegation (session key) is active — see {@link fireableNow}. */
export const DEMO_INTERVAL_SEC = 60;

/** Subset of schedules eligible to fire this tick. With a delegation active
 *  (`demoOnly`), only the Demo (1m) cadence the user opted into may fire; other
 *  intervals are deferred so the throwaway session key never silently signs them. */
export function fireableNow(list: ScheduledPayment[], demoOnly: boolean): ScheduledPayment[] {
  return demoOnly ? list.filter((s) => s.intervalSec === DEMO_INTERVAL_SEC) : list;
}

/** Advance a schedule's nextRun past `now` by whole intervals (no catch-up storm
 *  if the app was closed for days — it fires once, then lands in the future). */
export function reschedule(s: ScheduledPayment, now = Date.now()): ScheduledPayment {
  const interval = s.intervalSec * 1000;
  let next = s.nextRun + interval;
  if (next <= now) {
    // jump to the first whole interval strictly after `now`
    const missed = Math.floor((now - s.nextRun) / interval) + 1;
    next = s.nextRun + missed * interval;
  }
  return { ...s, nextRun: next };
}

export type SendFn = (currencyId: number, pubkey: string, encPub: string, amount: bigint) => Promise<unknown>;

export interface RunResult { id: string; label: string; status: "success" | "error"; error?: string; }

export interface RunOpts {
  /** Notified as each schedule's tx starts/ends, so the UI can show live status. */
  onFire?: (id: string, phase: "start" | "end") => void;
  /** Clock for the completion anchor (injectable for tests). Defaults to Date.now. */
  clock?: () => number;
}

/**
 * Fire every due schedule once. Returns the updated list (with nextRun re-anchored
 * on tx completion + run bookkeeping) and a per-payment result set. Runs are
 * sequential so two proofs never contend for the worker, and the next run is timed
 * from when the current tx finished (success or error) — so the countdown pauses
 * while a tx is in flight and restarts fresh, rather than elapsing through it.
 */
export async function runDue(
  list: ScheduledPayment[],
  send: SendFn,
  now = Date.now(),
  opts: RunOpts = {}
): Promise<{ list: ScheduledPayment[]; results: RunResult[] }> {
  const { onFire, clock = () => Date.now() } = opts;
  const results: RunResult[] = [];
  const byId = new Map(list.map((s) => [s.id, s]));

  for (const s of dueSchedules(list, now)) {
    let amount: bigint;
    try { amount = BigInt(s.amountBase); } catch { amount = 0n; }
    if (amount <= 0n) {
      byId.set(s.id, { ...s, active: false, lastStatus: "error", lastError: "invalid amount", lastRun: now });
      results.push({ id: s.id, label: s.label, status: "error", error: "invalid amount" });
      continue;
    }
    onFire?.(s.id, "start");
    try {
      await send(s.currencyId, s.toPubkey, s.toEncPub, amount);
      // Re-anchor the next run on completion, not the batch start, so the visible
      // countdown begins only once this tx finished (one whole interval ahead).
      const done = clock();
      byId.set(s.id, { ...s, lastRun: done, lastStatus: "success", lastError: undefined, runs: s.runs + 1, nextRun: done + s.intervalSec * 1000 });
      results.push({ id: s.id, label: s.label, status: "success" });
    } catch (e: any) {
      const err = String(e?.message ?? e);
      // retry one interval after this failure — same completion anchor, so we don't
      // hammer the chain and the countdown still restarts from the finish.
      const done = clock();
      byId.set(s.id, { ...s, lastRun: done, lastStatus: "error", lastError: err, nextRun: done + s.intervalSec * 1000 });
      results.push({ id: s.id, label: s.label, status: "error", error: err });
    } finally {
      onFire?.(s.id, "end");
    }
  }
  return { list: [...byId.values()], results };
}
