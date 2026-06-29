// React glue for timed "Merge privately" plans. Two hooks:
//   • useMergePlanner() — mounted ONCE (in Layout). The single firing loop: each
//     tick it loads the current identity's merge plans and fires any whose next
//     merge is due, one step at a time, via the wallet's mergeStep. Skips while a
//     manual tx is in flight so a paced merge never contends with a user action.
//   • useMergePlans() — live list + create/cancel for the current identity.
//
// Hands-off firing requires silent signing: local identities always sign
// silently, and wallet identities only when a session-key delegation is active.
// Without that, the plan is DEFERRED (left intact) rather than popping wallet
// prompts in the background — it resumes once a delegation is established.
import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet } from "../store/wallet";
import { useToast } from "../components/ui";
import {
  loadMergePlans, saveMergePlans, dueMergePlans, makeMergePlan,
  MERGE_MIN_GAP_MS, type MergePlan, type NewMergePlan,
} from "./mergePlan";

const CHANGED = "poof-merge-plans-changed";
const POLL_MS = 15_000;
/** After a failed merge, push the due step out so we don't retry every tick. */
const RETRY_DELAY_MS = 60_000;

function emitChanged() {
  window.dispatchEvent(new CustomEvent(CHANGED));
}

/** True iff fired merges can sign silently right now (local identity, or an
 *  active session-key delegation). Otherwise background firing is deferred. */
function canFireSilently(): boolean {
  const st = useWallet.getState();
  return st.signerKind === "local" || st.delegationActive();
}

/** The single background firing loop for timed merges. Mount once. */
export function useMergePlanner() {
  const seedHex = useWallet((s) => s.seedHex);
  const toast = useToast();
  const running = useRef(false);

  useEffect(() => {
    if (!seedHex) return;
    let cancelled = false;

    const tick = async () => {
      if (cancelled || running.current) return;
      if (useWallet.getState().busy) return; // don't contend with a manual tx
      const current = loadMergePlans(seedHex);
      const due = dueMergePlans(current);
      if (due.length === 0) return;
      if (!canFireSilently()) {
        // Due work exists but we can't sign silently (wallet identity with no /
        // expired delegation). Surface a "paused" state instead of skipping in
        // silence, so the user knows to re-authorize — then defer.
        const paused = current.map((p) =>
          due.some((d) => d.id === p.id) && !p.paused ? { ...p, paused: true } : p
        );
        if (paused.some((p, i) => p !== current[i])) {
          saveMergePlans(seedHex, paused);
          emitChanged();
        }
        return;
      }
      running.current = true;
      try {
        const mergeStep = useWallet.getState().mergeStep;
        const byId = new Map(current.map((p) => [p.id, p]));
        for (const plan of due) {
          if (cancelled) break;
          let amount: bigint;
          try { amount = BigInt(plan.amountBase); } catch { amount = 0n; }
          if (amount <= 0n) {
            byId.set(plan.id, { ...plan, active: false, lastStatus: "error", lastError: "invalid amount" });
            continue;
          }
          try {
            // Bump the merge counter as each pair lands and persist immediately so
            // the "x of k merges" UI (status row + bottom-right pill) updates live
            // mid-round, not just when the whole round finishes.
            const status = await mergeStep(plan.currencyId, amount, () => {
              const cur = byId.get(plan.id) ?? plan;
              const total = cur.totalMerges ?? cur.schedule.length;
              const merged = Math.min((cur.merged ?? 0) + 1, total);
              byId.set(plan.id, { ...cur, merged });
              saveMergePlans(seedHex, [...byId.values()]);
              emitChanged();
            }, canFireSilently);
            const cur = byId.get(plan.id) ?? plan;
            if (status === "paused") {
              // Delegation lapsed mid-round (mergeStep stopped rather than prompt
              // the wallet). Keep progress, DON'T advance the round, surface paused
              // so the user can re-authorize. The round resumes on a later tick.
              byId.set(plan.id, { ...cur, paused: true, lastRun: Date.now() });
              continue;
            }
            const fired = plan.fired + 1;
            const done = status === "done" || fired >= plan.schedule.length;
            byId.set(plan.id, {
              ...cur, fired, active: !done, lastRun: Date.now(), lastStatus: "ok", lastError: undefined,
              paused: false,
              merged: done ? (cur.totalMerges ?? cur.schedule.length) : cur.merged,
            });
            // Neutral wording: a plan can be started from Send or Withdraw and the
            // plan carries no intent, so don't presume the user wants to withdraw.
            if (done) toast.push(`"${plan.label}" is ready to send or withdraw`, "ok");
          } catch (e: any) {
            // mergeStep already retried each pair a few times; on a persistent
            // failure, push this round's due time out so a later tick retries it
            // (the round re-plans from on-chain state, so partial progress is kept).
            const cur = byId.get(plan.id) ?? plan;
            const schedule = [...cur.schedule];
            schedule[cur.fired] = Date.now() + RETRY_DELAY_MS;
            byId.set(plan.id, {
              ...cur, schedule, lastRun: Date.now(), lastStatus: "error", lastError: String(e?.message ?? e),
              paused: false,
            });
          }
        }
        if (cancelled) return;
        saveMergePlans(seedHex, [...byId.values()]);
        emitChanged();
      } finally {
        running.current = false;
      }
    };

    const iv = setInterval(tick, POLL_MS);
    const t = setTimeout(tick, 4000); // settle after a fresh load before firing
    return () => { cancelled = true; clearInterval(iv); clearTimeout(t); };
  }, [seedHex, toast]);
}

/** Live merge-plan list + create/cancel for the current identity. */
export function useMergePlans() {
  const seedHex = useWallet((s) => s.seedHex);
  const [list, setList] = useState<MergePlan[]>([]);

  const refresh = useCallback(() => {
    setList(seedHex ? loadMergePlans(seedHex) : []);
  }, [seedHex]);

  useEffect(() => {
    refresh();
    window.addEventListener(CHANGED, refresh);
    return () => window.removeEventListener(CHANGED, refresh);
  }, [refresh]);

  const persist = useCallback((next: MergePlan[]) => {
    if (!seedHex) return;
    saveMergePlans(seedHex, next);
    setList(next);
    emitChanged();
  }, [seedHex]);

  const add = useCallback((input: NewMergePlan): MergePlan | null => {
    if (!seedHex) return null;
    const plan = makeMergePlan(input);
    persist([plan, ...loadMergePlans(seedHex)]);
    return plan;
  }, [seedHex, persist]);

  const cancel = useCallback((id: string) => {
    persist(loadMergePlans(seedHex ?? "").filter((p) => p.id !== id));
  }, [seedHex, persist]);

  return { list, add, cancel };
}

export { MERGE_MIN_GAP_MS };
