import { Spinner } from "./ui";
import type { MergeProgress } from "../lib/types";

/** Shown while an immediate (silent or "Do it anyways") consolidation runs, before
 *  the real send/withdraw. Surfaces the balanced-tree merge progress so the user
 *  knows why their spend is taking an extra moment. */
export default function MergePrepBanner({ progress }: { progress: MergeProgress }) {
  const pct = progress.totalSteps > 0 ? (progress.step / progress.totalSteps) * 100 : 0;
  return (
    <div className="card p-4 animate-fade-in" data-testid="merge-prep">
      <div className="flex items-center gap-2 text-sm font-medium text-poof-lavender">
        <Spinner className="h-4 w-4" />
        Preparing notes — merging {progress.step} of {progress.totalSteps}
        {progress.totalRounds > 1 && (
          <span className="text-poof-muted font-normal">· round {progress.round}/{progress.totalRounds}</span>
        )}
      </div>
      <div className="mt-2 h-1.5 w-full rounded-full bg-poof-surface overflow-hidden">
        <div className="h-full bg-poof-lavender transition-all duration-300" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs text-poof-muted mt-2">
        Combining your notes so this amount fits in one transaction. This doesn't move funds out of your wallet.
      </p>
    </div>
  );
}
