import { useWallet } from "../store/wallet";
import { StatusChip, truncate, EmptyState } from "../components/ui";
import { EXPLORER_TX } from "../lib/types";
import { formatAmount } from "../lib/currencies";
import PoofLottie from "../components/fx/PoofLottie";

export default function Activity() {
  const { txs } = useWallet();
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-poof-lavender/15 grid place-items-center">
          <svg className="h-5 w-5 text-poof-lavender" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h4l3 8 4-16 3 8h4"/></svg>
        </div>
        <h1 className="text-2xl font-bold">Activity</h1>
      </div>
      {txs.length === 0 ? (
        <EmptyState
          title="No activity yet"
          sub="Your transactions will appear here."
          icon={<PoofLottie name="bored" className="h-28 w-28 mx-auto" />}
        />
      ) : (
        <div className="card divide-y divide-poof-border">
          {txs.map((t) => (
            <div key={t.id} className="px-5 py-4 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full shrink-0 ${t.kind === "deposit" ? "bg-poof-success" : t.kind === "withdraw" ? "bg-poof-gold" : t.kind === "transfer" ? "bg-poof-lavender" : "bg-poof-accent"}`} />
                  <span className="capitalize font-medium">{t.kind}</span>
                  <StatusChip status={t.status} />
                </div>
                <div className="text-xs text-poof-muted mt-0.5">{new Date(t.createdAt).toLocaleString()}</div>
                {t.error && <div className="text-xs text-poof-danger mt-1 max-w-md break-words">{t.error}</div>}
              </div>
              <div className="text-right">
                <div className="tabular-nums font-medium">{formatAmount(t.amount, t.currencyId)}</div>
                {t.hash && (
                  <a href={EXPLORER_TX + t.hash} target="_blank" rel="noreferrer" className="text-xs text-poof-gold hover:underline">
                    {truncate(t.hash, 6, 4)} ↗
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
