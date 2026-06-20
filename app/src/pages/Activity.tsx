import { useWallet } from "../store/wallet";
import { StatusChip, truncate, EmptyState } from "../components/ui";
import { EXPLORER_TX } from "../lib/types";
import { formatAmount } from "../lib/currencies";

export default function Activity() {
  const { txs } = useWallet();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Activity</h1>
      {txs.length === 0 ? (
        <EmptyState title="No activity yet" sub="Your transactions will appear here." />
      ) : (
        <div className="card divide-y divide-veil-border">
          {txs.map((t) => (
            <div key={t.id} className="px-5 py-4 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="capitalize font-medium">{t.kind}</span>
                  <StatusChip status={t.status} />
                </div>
                <div className="text-xs text-veil-muted mt-0.5">{new Date(t.createdAt).toLocaleString()}</div>
                {t.error && <div className="text-xs text-veil-danger mt-1 max-w-md break-words">{t.error}</div>}
              </div>
              <div className="text-right">
                <div className="tabular-nums font-medium">{formatAmount(t.amount, t.currencyId)}</div>
                {t.hash && (
                  <a href={EXPLORER_TX + t.hash} target="_blank" rel="noreferrer" className="text-xs text-veil-accent hover:underline">
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
