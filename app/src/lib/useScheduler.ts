// React glue for recurring payments. Two hooks:
//   • useSchedulePoller() — mounted ONCE (in Layout). The single firing loop:
//     every tick it loads the current identity's schedules and runs anything due
//     via the wallet's send. Skips a tick while a manual tx is in flight so a
//     scheduled proof never contends with a user-initiated one.
//   • useSchedules() — for the Scheduled page: the live list + CRUD. It reloads
//     whenever the shared "changed" event fires (including after the poller runs),
//     so the UI stays in sync with the single source of truth (localStorage).
import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet } from "../store/wallet";
import { useToast } from "../components/ui";
import {
  loadSchedules, saveSchedules, dueSchedules, runDue, makeSchedule, fireableNow,
  type ScheduledPayment, type NewSchedule,
} from "./schedule";

const CHANGED = "poof-schedules-changed";
const FIRING = "poof-schedule-firing";
const POLL_MS = 15_000;

function emitChanged() {
  window.dispatchEvent(new CustomEvent(CHANGED));
}

// Shared "currently firing" set — the single source of truth for which schedules
// have a tx in flight right now, whether fired by the background poller or the
// manual "Run now" button. The Scheduled page subscribes via useFiringSchedules()
// to swap a row's countdown for the live tx stage.
const firing = new Set<string>();
function markFiring(id: string, on: boolean) {
  if (on) firing.add(id); else firing.delete(id);
  window.dispatchEvent(new CustomEvent(FIRING));
}

/** Live snapshot of the schedule ids whose tx is in flight right now. */
export function useFiringSchedules(): Set<string> {
  const [snap, setSnap] = useState<Set<string>>(() => new Set(firing));
  useEffect(() => {
    const refresh = () => setSnap(new Set(firing));
    window.addEventListener(FIRING, refresh);
    return () => window.removeEventListener(FIRING, refresh);
  }, []);
  return snap;
}

/** The single background firing loop. Mount once. */
export function useSchedulePoller() {
  const seedHex = useWallet((s) => s.seedHex);
  const send = useWallet((s) => s.send);
  const toast = useToast();
  const running = useRef(false);

  useEffect(() => {
    if (!seedHex) return;
    let cancelled = false;

    const tick = async () => {
      if (cancelled || running.current) return;
      if (useWallet.getState().busy) return; // don't contend with a manual tx
      const current = loadSchedules(seedHex);
      // While a delegation (session key) is active, only auto-fire the Demo (1m)
      // cadence the user opted into — the session signer must not silently sign
      // longer-interval schedules. Non-Demo schedules are deferred (left intact)
      // and resume their normal wallet-prompt firing once delegation ends.
      const delegated = useWallet.getState().delegationActive();
      const fireable = fireableNow(current, delegated);
      if (dueSchedules(fireable).length === 0) return;
      running.current = true;
      try {
        const { results, list: outFire } = await runDue(fireable, send, Date.now(), {
          onFire: (id, phase) => markFiring(id, phase === "start"),
        });
        if (cancelled) return;
        // Merge the fired subset back over the full list so deferred (non-Demo)
        // schedules are preserved untouched.
        const byId = new Map(outFire.map((s) => [s.id, s]));
        const out = current.map((s) => byId.get(s.id) ?? s);
        saveSchedules(seedHex, out);
        emitChanged();
        for (const r of results) {
          if (r.status === "success") toast.push(`Scheduled "${r.label}" sent`, "ok");
          else toast.push(`Scheduled "${r.label}" failed: ${r.error}`, "err");
        }
      } finally {
        running.current = false;
      }
    };

    const iv = setInterval(tick, POLL_MS);
    // a small initial delay so a fresh load settles (tree sync) before firing
    const t = setTimeout(tick, 4000);
    return () => { cancelled = true; clearInterval(iv); clearTimeout(t); };
  }, [seedHex, send, toast]);
}

/** Live schedule list + CRUD for the current identity. */
export function useSchedules() {
  const seedHex = useWallet((s) => s.seedHex);
  const send = useWallet((s) => s.send);
  const toast = useToast();
  const [list, setList] = useState<ScheduledPayment[]>([]);
  const [runningId, setRunningId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setList(seedHex ? loadSchedules(seedHex) : []);
  }, [seedHex]);

  useEffect(() => {
    refresh();
    window.addEventListener(CHANGED, refresh);
    return () => window.removeEventListener(CHANGED, refresh);
  }, [refresh]);

  const persist = useCallback((next: ScheduledPayment[]) => {
    if (!seedHex) return;
    saveSchedules(seedHex, next);
    setList(next);
    emitChanged();
  }, [seedHex]);

  const add = useCallback((input: NewSchedule) => {
    const next = [makeSchedule(input), ...loadSchedules(seedHex ?? "")];
    persist(next);
  }, [seedHex, persist]);

  const remove = useCallback((id: string) => {
    persist(loadSchedules(seedHex ?? "").filter((s) => s.id !== id));
  }, [seedHex, persist]);

  const toggle = useCallback((id: string) => {
    persist(loadSchedules(seedHex ?? "").map((s) => (s.id === id ? { ...s, active: !s.active } : s)));
  }, [seedHex, persist]);

  /** Fire one schedule now (sets it due and runs just that one). */
  const runNow = useCallback(async (id: string) => {
    if (!seedHex) return;
    const current = loadSchedules(seedHex);
    const one = current.find((s) => s.id === id);
    if (!one) return;
    setRunningId(id);
    try {
      const { list: outOne, results } = await runDue([{ ...one, nextRun: 0, active: true }], send, Date.now(), {
        onFire: (sid, phase) => markFiring(sid, phase === "start"),
      });
      // merge the single result back into the full list
      const merged = current.map((s) => (s.id === id ? { ...outOne[0], active: s.active } : s));
      persist(merged);
      const r = results[0];
      if (r?.status === "success") toast.push(`"${one.label}" sent`, "ok");
      else if (r) toast.push(`"${one.label}" failed: ${r.error}`, "err");
    } finally {
      setRunningId(null);
    }
  }, [seedHex, send, persist, toast]);

  return { list, add, remove, toggle, runNow, runningId };
}
