import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useWallet } from "../store/wallet";
import { StatCard, AddressBadge, StatusChip, truncate, Spinner } from "../components/ui";
import { EXPLORER_TX } from "../lib/types";
import { CURRENCIES, currencyById, fromBaseUnits, formatAmount } from "../lib/currencies";

export default function Dashboard() {
  const s = useWallet();
  const balances = s.balancesByCurrency ?? {};
  const heldCurrencies = CURRENCIES.filter((c) => (balances[c.id] ?? 0n) > 0n);
  // Hero currency: prefer XLM if held, else the first held asset, else XLM (zero).
  // Keeps a held-only-VUSD balance visible instead of always showing "0 XLM".
  const hero = heldCurrencies.find((c) => c.id === 0) ?? heldCurrencies[0] ?? currencyById(0);
  const otherHeld = heldCurrencies.filter((c) => c.id !== hero.id);
  useEffect(() => {
    s.refreshFeeBalance().catch(() => {});
    s.syncChain().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-veil-muted text-sm">Your shielded balance lives only in encrypted notes — never on a public ledger.</p>
        </div>
        <button onClick={() => s.syncChain()} className="btn-ghost text-sm" disabled={s.syncing}>
          {s.syncing ? <Spinner className="h-4 w-4" /> : "↻"} Sync
        </button>
      </div>

      <div className="card p-7 shadow-glow border-veil-primary/30 bg-gradient-to-br from-veil-primary/10 to-transparent">
        <div className="text-sm text-veil-muted">Shielded balance</div>
        <div data-testid="balance" className="text-5xl font-bold tabular-nums mt-1">
          {fromBaseUnits(balances[hero.id] ?? 0n, hero.decimals)} <span className="text-2xl text-veil-muted">{hero.symbol}</span>
        </div>
        {otherHeld.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2" data-testid="balance-breakdown">
            {otherHeld.map((c) => (
              <span key={c.id} className="rounded-full bg-veil-primary/10 px-3 py-1 text-sm tabular-nums">
                {fromBaseUnits(balances[c.id] ?? 0n, c.decimals)} {c.symbol}
              </span>
            ))}
          </div>
        )}
        <div className="mt-4 flex flex-wrap gap-3">
          <Link to="/deposit" className="btn-primary">Deposit</Link>
          <Link to="/send" className="btn-ghost">Send</Link>
          <Link to="/receive" className="btn-ghost">Receive</Link>
        </div>
      </div>

      <div className="grid sm:grid-cols-3 gap-4">
        <StatCard label="Notes" value={s.notes.filter((n) => !n.spent).length} sub={`${s.notes.length} total`} />
        <StatCard label="Tree leaves" value={s.nextLeafIndex ?? "—"} sub="commitments on-chain" />
        <StatCard label="Current root" value={<span className="mono text-base">{s.currentRoot ? truncate(s.currentRoot, 6, 4) : "—"}</span>} sub="depth-20 Merkle" />
      </div>

      <div className="card p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="font-medium">Your Veil address</div>
          <Link to="/receive" className="text-sm text-veil-primary hover:underline">Show full ↗</Link>
        </div>
        {s.address && <AddressBadge value={s.address.pubkey} label="pubkey" testid="dash-address" />}
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">Recent activity</h2>
          <Link to="/activity" className="text-sm text-veil-muted hover:text-veil-text">View all</Link>
        </div>
        {s.txs.length === 0 ? (
          <div className="card p-8 text-center text-veil-muted text-sm">No transactions yet. Deposit to mint your first private note.</div>
        ) : (
          <div className="card divide-y divide-veil-border">
            {s.txs.slice(0, 5).map((t) => (
              <div key={t.id} className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="capitalize font-medium">{t.kind}</span>
                  <StatusChip status={t.status} />
                </div>
                <div className="flex items-center gap-4">
                  <span className="tabular-nums">{formatAmount(t.amount, t.currencyId)}</span>
                  {t.hash && <a href={EXPLORER_TX + t.hash} target="_blank" rel="noreferrer" className="text-xs text-veil-accent hover:underline">{truncate(t.hash, 6, 4)} ↗</a>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
