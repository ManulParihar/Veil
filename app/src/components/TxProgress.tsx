import { TxRecord, EXPLORER_TX } from "../lib/types";
import { formatAmount } from "../lib/currencies";
import { Spinner, truncate } from "./ui";
import PoofSparkle from "./PoofSparkle";
import PoofLottie, { PoofAnim } from "./fx/PoofLottie";

const STEPS: { key: TxRecord["status"]; label: string }[] = [
  { key: "building", label: "Build witness" },
  { key: "proving", label: "Generate proof" },
  { key: "submitting", label: "Submit on-chain" },
  { key: "success", label: "Confirmed" },
];

const order = (s: TxRecord["status"]) => STEPS.findIndex((x) => x.key === s);

// Which dotLottie keeps the user company at each stage — a little humour while
// the SNARK cooks and the chain confirms.
const STAGE_ANIM: Partial<Record<TxRecord["status"], PoofAnim>> = {
  building: "bored",
  proving: "dog",
  submitting: "dog",
  success: "transfer",
};

/** Renders the building→proving→submitting→confirmed stepper for a tx record. */
export default function TxProgress({ tx }: { tx: TxRecord }) {
  const idx = order(tx.status);
  const failed = tx.status === "error";
  const cur = failed ? 99 : idx;
  // 0→100 across the four steps; full on success, ~80% if it died mid-submit.
  const pct = failed ? 80 : tx.status === "success" ? 100 : ((idx + 0.5) / STEPS.length) * 100;
  const anim = STAGE_ANIM[tx.status];

  return (
    <div className="card p-6 animate-fade-in relative overflow-hidden" data-testid="tx-progress">
      {/* faint glow that follows the active state */}
      <div
        className={`pointer-events-none absolute -top-24 left-1/2 h-48 w-48 -translate-x-1/2 rounded-full blur-3xl transition-colors ${
          failed ? "bg-poof-danger/10" : tx.status === "success" ? "bg-poof-success/15" : "bg-poof-lavender/10"
        }`}
      />

      <div className="relative flex items-center justify-between mb-4">
        <div className="font-medium capitalize">
          {tx.kind} · <span className="text-magic font-semibold">{formatAmount(tx.amount, tx.currencyId)}</span>
        </div>
        <div data-testid="tx-status" className="text-sm">
          {failed ? (
            <span className="text-poof-danger">failed</span>
          ) : tx.status === "success" ? (
            <span className="inline-flex items-center gap-1.5 text-poof-success">✨ confirmed</span>
          ) : (
            <span className="inline-flex items-center gap-2 text-poof-lavender">
              <Spinner className="h-4 w-4" />
              {tx.stage}
            </span>
          )}
        </div>
      </div>

      {/* the redesigned progress bar */}
      <div className="relative poof-progress-track mb-5">
        <div
          className={`poof-progress-fill ${failed ? "!bg-none !bg-poof-danger !shadow-none" : ""}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="relative flex items-center gap-4">
        <ol className="flex-1 space-y-3">
          {STEPS.map((step, i) => {
            const done = cur > i || tx.status === "success";
            const active = idx === i && tx.status !== "success" && !failed;
            const stepFailed = failed && i === Math.max(order("submitting"), 0);
            return (
              <li key={step.key} className="flex items-center gap-3">
                <span
                  className={`grid place-items-center h-7 w-7 rounded-full border text-xs transition ${
                    done
                      ? "bg-poof-success/20 border-poof-success text-poof-success"
                      : active
                      ? "border-poof-lavender text-poof-lavender shadow-[0_0_12px_-2px_rgba(167,139,250,0.7)]"
                      : stepFailed
                      ? "border-poof-danger text-poof-danger"
                      : "border-poof-border text-poof-muted"
                  }`}
                >
                  {done ? "✓" : active ? <Spinner className="h-3.5 w-3.5" /> : i + 1}
                </span>
                <span className={done || active ? "text-poof-text" : "text-poof-muted"}>{step.label}</span>
                {done && step.key === "success" && <PoofSparkle active count={12} className="ml-1 w-5 h-5" />}
              </li>
            );
          })}
        </ol>

        {/* the humorous companion animation, sized to the stepper */}
        {anim && (
          <PoofLottie
            name={anim}
            loop={tx.status !== "success"}
            className="h-20 w-20 shrink-0 opacity-90"
          />
        )}
      </div>

      {failed && <div className="mt-4 text-sm text-poof-danger break-words">{tx.error}</div>}
      {tx.hash && (
        <a
          href={EXPLORER_TX + tx.hash}
          target="_blank"
          rel="noreferrer"
          data-testid="tx-hash"
          className="relative mt-4 inline-flex items-center gap-2 text-sm text-poof-gold hover:underline"
        >
          View on Stellar Expert · {truncate(tx.hash)} ↗
        </a>
      )}
    </div>
  );
}
