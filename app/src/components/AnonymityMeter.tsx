import { useMemo } from "react";
import { useWallet } from "../store/wallet";
import { assessSpend, LEVEL_LABEL, type AnonLevel } from "../lib/anonymitySet";

const BAR: Record<AnonLevel, string> = {
  danger: "bg-poof-danger",
  warn: "bg-poof-warn",
  good: "bg-poof-lavender",
  strong: "bg-poof-success",
};
const TEXT: Record<AnonLevel, string> = {
  danger: "text-poof-danger",
  warn: "text-poof-warn",
  good: "text-poof-lavender",
  strong: "text-poof-success",
};
const FILL: Record<AnonLevel, string> = { danger: "25%", warn: "50%", good: "75%", strong: "100%" };

/**
 * Pre-spend privacy indicator: anonymity-set size + how buried the funds being
 * spent are. Shown on Send/Withdraw so the user sees their cover *before* they
 * commit — and is nudged to wait when a note is freshly deposited.
 */
export default function AnonymityMeter({ currencyId }: { currencyId: number }) {
  const notes = useWallet((s) => s.notes);
  const nextLeafIndex = useWallet((s) => s.nextLeafIndex);
  const a = useMemo(() => assessSpend(notes, currencyId, nextLeafIndex), [notes, currencyId, nextLeafIndex]);

  return (
    <div data-testid="anonymity-meter" className="rounded-xl border border-poof-border bg-poof-surface/60 p-3.5 space-y-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <svg className="h-4 w-4 text-poof-lavender" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/></svg>
          Anonymity
        </div>
        <span data-testid="anonymity-level" className={`text-xs font-semibold ${TEXT[a.overall]}`}>{LEVEL_LABEL[a.overall]}</span>
      </div>

      <div className="poof-progress-track !h-1.5">
        <div className={`h-full rounded-full transition-all ${BAR[a.overall]}`} style={{ width: FILL[a.overall] }} />
      </div>

      <div className="flex items-center justify-between text-xs text-poof-muted">
        <span><span className="tabular-nums text-poof-text">{a.setSize}</span> in pool</span>
        {a.freshest !== null && (
          <span><span className="tabular-nums text-poof-text">{a.freshest}</span> deposits since yours</span>
        )}
      </div>

      <p className={`text-xs ${a.overall === "danger" ? "text-poof-danger" : "text-poof-muted"}`}>{a.message}</p>
    </div>
  );
}
