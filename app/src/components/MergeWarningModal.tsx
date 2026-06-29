import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ShieldAlert, Zap, Clock } from "lucide-react";
import IntervalSelect from "./IntervalSelect";
import { Spinner } from "./ui";
import { useWallet } from "../store/wallet";

/**
 * Shown when spending an amount needs combining MORE than four notes (≥2 merge
 * rounds). Warns that merging everything links the notes to one output, then
 * offers two paths: merge now (fast, back-to-back), or "Merge privately" — pace
 * the merges over a chosen window at randomized intervals so they don't burst.
 */
export default function MergeWarningModal({
  noteCount,
  amountLabel,
  busy = false,
  onClose,
  onDoItAnyways,
  onMergePrivately,
}: {
  noteCount: number;
  /** e.g. "1,234 VUSD" — the amount being spent. */
  amountLabel: string;
  /** true while the immediate ("Do it anyways") merge is running. */
  busy?: boolean;
  onClose: () => void;
  /** `delegate` = mint a throwaway session key so the back-to-back merges (and
   *  the trailing spend) sign silently — no wallet prompt at each step. */
  onDoItAnyways: (delegate: boolean) => void;
  /** user picked a window; `deadlineSec` = seconds from now to be ready by.
   *  `delegate` = mint a throwaway session key so paced merges fire unattended. */
  onMergePrivately: (deadlineSec: number, delegate: boolean) => void;
}) {
  const [mode, setMode] = useState<"choose" | "private">("choose");
  const [deadlineSec, setDeadlineSec] = useState(3600); // default: ready in an hour
  // External-wallet identities need a session key to sign paced merges without a
  // wallet prompt each step; local identities already sign silently (no checkbox).
  const signerKind = useWallet((s) => s.signerKind);
  const delegationActive = useWallet((s) => s.delegationActive);
  const canDelegate = signerKind === "wallet";
  const alreadyDelegated = canDelegate && delegationActive();
  const [delegate, setDelegate] = useState(true);
  // Effective flag passed to either path: only meaningful for wallet identities
  // that aren't already delegated.
  const effectiveDelegate = canDelegate && !alreadyDelegated && delegate;

  // Shared delegate control — applies to BOTH "Do it anyways" and "Merge
  // privately", so the back-to-back or paced merges sign without a wallet prompt
  // at each step. Local identities already sign silently (no checkbox).
  const delegateControl = canDelegate ? (
    alreadyDelegated ? (
      <p className="text-xs text-poof-gold/90">
        Delegated signing is active — these merges run without a wallet prompt.
      </p>
    ) : (
      <label className="flex items-start gap-2.5 rounded-xl border border-poof-border bg-poof-surface/50 p-3 cursor-pointer">
        <input
          type="checkbox"
          data-testid="merge-delegate"
          checked={delegate}
          onChange={(e) => setDelegate(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-poof-gold"
        />
        <span className="text-xs text-poof-muted">
          <span className="text-poof-text font-medium">Delegate signing</span> with a throwaway
          session key so the merges sign on their own — no wallet prompt at each step.
          Without it, you approve every merge in your wallet, and they only run while this app is open.
        </span>
      </label>
    )
  ) : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose, busy]);

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => !busy && onClose()} />
      <motion.div
        className="card relative w-full max-w-md p-6 space-y-4"
        initial={{ scale: 0.95, opacity: 0, y: 12 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        role="dialog"
        aria-modal="true"
        data-testid="merge-warning-modal"
      >
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-poof-warn/15 grid place-items-center shrink-0">
            <ShieldAlert className="h-5 w-5 text-poof-warn" />
          </div>
          <div>
            <h2 className="text-lg font-bold leading-tight">This combines many notes</h2>
            <p className="text-xs text-poof-muted mt-0.5">Spending {amountLabel} needs {noteCount} notes merged first.</p>
          </div>
        </div>

        <p className="text-sm text-poof-muted">
          Merging your notes makes it easier to <span className="text-poof-text">link them to a single output</span>.
          The final transaction always reveals it was funded by these notes — but <span className="text-poof-text">how</span> you
          merge changes the timing trail you leave.
        </p>

        {mode === "choose" ? (
          <div className="space-y-2.5">
            {delegateControl}
            <button
              data-testid="merge-do-anyways"
              onClick={() => onDoItAnyways(effectiveDelegate)}
              disabled={busy}
              className="w-full text-left rounded-xl border border-poof-border bg-poof-surface/50 p-3.5 hover:border-poof-lavender/50 transition disabled:opacity-60"
            >
              <div className="flex items-center gap-2 font-medium">
                {busy ? <Spinner className="h-4 w-4" /> : <Zap className="h-4 w-4 text-poof-lavender" />}
                {busy ? "Merging…" : "Do it anyways"}
              </div>
              <p className="text-xs text-poof-muted mt-1">
                Merge now and continue. Fast, but the merges happen back-to-back — an observer sees one burst that ties the notes together.
              </p>
            </button>

            <button
              data-testid="merge-privately"
              onClick={() => setMode("private")}
              disabled={busy}
              className="w-full text-left rounded-xl border border-poof-gold/40 bg-poof-gold/5 p-3.5 hover:border-poof-gold transition disabled:opacity-60"
            >
              <div className="flex items-center gap-2 font-medium text-poof-gold">
                <Clock className="h-4 w-4" />
                Merge privately
              </div>
              <p className="text-xs text-poof-muted mt-1">
                Spread the merges over time at random intervals so they don't burst. Pick when the amount should be ready; we consolidate in the background — you return to withdraw.
              </p>
            </button>

            <button onClick={onClose} disabled={busy} className="w-full text-center text-xs text-poof-muted hover:text-poof-text py-1.5 transition disabled:opacity-60">
              Cancel
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <div className="label">Have it ready in</div>
              <IntervalSelect value={deadlineSec} onChange={setDeadlineSec} testid="merge-deadline" />
              <p className="text-xs text-poof-muted mt-1.5">
                We'll merge {noteCount} notes into a spendable balance by then, spacing each step at random.
                This only <span className="text-poof-text">consolidates</span> — nothing leaves your wallet until you withdraw.
              </p>
            </div>

            <div className="flex gap-2">
              <button onClick={() => setMode("choose")} className="btn-ghost flex-1 py-2.5">Back</button>
              <button
                data-testid="merge-private-confirm"
                onClick={() => onMergePrivately(deadlineSec, effectiveDelegate)}
                className="btn-primary flex-1 py-2.5"
              >
                Schedule merge
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
