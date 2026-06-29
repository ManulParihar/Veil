import { Clock, X } from "lucide-react";
import { useWallet } from "../store/wallet";
import { useMergePlans } from "../lib/useMergePlanner";
import { mergeProgress, nextFireAt, type MergePlan } from "../lib/mergePlan";
import MergePrepBanner from "./MergePrepBanner";

/** Persistent merge status — driven by the STORE (immediate run) and localStorage
 *  (timed plans), so it survives navigating away from and back to Send/Withdraw,
 *  and resumes showing an in-progress consolidation. Render it on the spend pages.
 *  Pass `currencyId` to only show work for the asset in view (omit to show all). */
export default function MergeStatus({ currencyId }: { currencyId?: number }) {
  const mergeRunning = useWallet((s) => s.mergeRunning);
  const progress = useWallet((s) => s.mergeProgress);
  const { list, cancel } = useMergePlans();

  const showImmediate =
    mergeRunning && progress && (currencyId == null || progress.currencyId === currencyId);
  const plans = list.filter(
    (p) => p.active && (currencyId == null || p.currencyId === currencyId)
  );

  if (!showImmediate && plans.length === 0) return null;

  return (
    <div className="space-y-3" data-testid="merge-status">
      {showImmediate && progress && <MergePrepBanner progress={progress} />}
      {plans.map((p) => (
        <TimedPlanRow key={p.id} plan={p} onCancel={() => cancel(p.id)} />
      ))}
    </div>
  );
}

function TimedPlanRow({ plan, onCancel }: { plan: MergePlan; onCancel: () => void }) {
  const { done, total } = mergeProgress(plan);
  const pct = total > 0 ? (done / total) * 100 : 0;
  const next = nextFireAt(plan);
  const fmt = (ms: number) => new Date(ms).toLocaleString([], { dateStyle: "short", timeStyle: "short" });

  return (
    <div className="card p-4 animate-fade-in" data-testid="merge-plan-row">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium text-poof-gold">
          <Clock className="h-4 w-4" />
          Private merge · {plan.label}
        </div>
        <button
          onClick={onCancel}
          className="text-poof-muted hover:text-poof-danger transition shrink-0"
          aria-label="Cancel private merge"
          data-testid="merge-plan-cancel"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-2 flex items-center justify-between text-xs text-poof-muted">
        <span className="tabular-nums">{done} of {total} merges done</span>
        <span>{done >= total ? "ready to spend" : `ready by ${fmt(plan.deadline)}`}</span>
      </div>
      <div className="mt-1.5 h-1.5 w-full rounded-full bg-poof-surface overflow-hidden">
        <div className="h-full bg-poof-gold transition-all duration-300" style={{ width: `${pct}%` }} />
      </div>
      {plan.paused ? (
        <p className="text-[11px] text-poof-warn mt-2" data-testid="merge-plan-paused">
          Paused — delegated signing ended. Re-authorize on the Scheduled page to resume unattended, or it resumes when you approve in your wallet.
        </p>
      ) : next != null && done < total ? (
        <p className="text-[11px] text-poof-muted/80 mt-2">
          Next merge around {fmt(next)} · spaced at random to avoid a burst. Runs while the app is open.
        </p>
      ) : null}
    </div>
  );
}
