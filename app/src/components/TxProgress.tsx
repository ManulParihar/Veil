import { TxRecord, EXPLORER_TX, fromStroops } from "../lib/types";
import { Spinner, truncate } from "./ui";

const STEPS: { key: TxRecord["status"]; label: string }[] = [
  { key: "building", label: "Build witness" },
  { key: "proving", label: "Generate proof" },
  { key: "submitting", label: "Submit on-chain" },
  { key: "success", label: "Confirmed" },
];

const order = (s: TxRecord["status"]) => STEPS.findIndex((x) => x.key === s);

/** Renders the building→proving→submitting→confirmed stepper for a tx record. */
export default function TxProgress({ tx }: { tx: TxRecord }) {
  const cur = tx.status === "error" ? 99 : order(tx.status);
  return (
    <div className="card p-6 animate-fade-in" data-testid="tx-progress">
      <div className="flex items-center justify-between mb-5">
        <div className="font-medium capitalize">{tx.kind} · {fromStroops(tx.amount)} XLM</div>
        <div data-testid="tx-status" className="text-sm">
          {tx.status === "error" ? <span className="text-veil-danger">failed</span>
            : tx.status === "success" ? <span className="text-veil-success">confirmed</span>
            : <span className="inline-flex items-center gap-2 text-veil-primary"><Spinner className="h-4 w-4" />{tx.stage}</span>}
        </div>
      </div>
      <ol className="space-y-3">
        {STEPS.map((step, i) => {
          const done = cur > i || tx.status === "success";
          const active = order(tx.status) === i && tx.status !== "success" && tx.status !== "error";
          const failed = tx.status === "error" && i === Math.max(order("submitting"), 0);
          return (
            <li key={step.key} className="flex items-center gap-3">
              <span className={`grid place-items-center h-7 w-7 rounded-full border text-xs ${
                done ? "bg-veil-success/20 border-veil-success text-veil-success"
                : active ? "border-veil-primary text-veil-primary"
                : failed ? "border-veil-danger text-veil-danger"
                : "border-veil-border text-veil-muted"}`}>
                {done ? "✓" : active ? <Spinner className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span className={`${done ? "text-veil-text" : active ? "text-veil-text" : "text-veil-muted"}`}>{step.label}</span>
            </li>
          );
        })}
      </ol>
      {tx.status === "error" && <div className="mt-4 text-sm text-veil-danger break-words">{tx.error}</div>}
      {tx.hash && (
        <a href={EXPLORER_TX + tx.hash} target="_blank" rel="noreferrer"
          data-testid="tx-hash"
          className="mt-4 inline-flex items-center gap-2 text-sm text-veil-accent hover:underline">
          View on Stellar Expert · {truncate(tx.hash)} ↗
        </a>
      )}
    </div>
  );
}
