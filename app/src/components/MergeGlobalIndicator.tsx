import { useNavigate } from "react-router-dom";
import { Layers } from "lucide-react";
import { useWallet } from "../store/wallet";
import { useMergePlans } from "../lib/useMergePlanner";

/** A compact, app-wide pill that surfaces ongoing note-merge work from ANY page —
 *  the immediate consolidation (store-backed) or the timed "Merge privately" plans
 *  (localStorage-backed). Mounted once in Layout. Tapping jumps to Activity. */
export default function MergeGlobalIndicator() {
  const nav = useNavigate();
  const mergeRunning = useWallet((s) => s.mergeRunning);
  const progress = useWallet((s) => s.mergeProgress);
  const { list } = useMergePlans();

  const active = list.filter((p) => p.active);
  const label = mergeRunning && progress
    ? `Merging notes · ${progress.step}/${progress.totalSteps}`
    : active.length > 0
      ? (() => {
          const done = active.reduce((s, p) => s + Math.min(p.merged ?? p.fired, p.totalMerges ?? p.schedule.length), 0);
          const total = active.reduce((s, p) => s + (p.totalMerges ?? p.schedule.length), 0);
          return `Private merge · ${done}/${total}`;
        })()
      : null;

  if (!label) return null;

  return (
    <button
      onClick={() => nav("/app/activity")}
      data-testid="merge-global-indicator"
      className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full border border-poof-gold/40
                 bg-poof-card/95 px-3.5 py-2 text-xs font-medium text-poof-gold shadow-glow
                 backdrop-blur-xl hover:border-poof-gold transition animate-fade-in"
      title="View merge activity"
    >
      <Layers className="h-3.5 w-3.5 animate-pulse" />
      {label}
    </button>
  );
}
