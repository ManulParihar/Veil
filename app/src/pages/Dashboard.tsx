import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useWallet } from "../store/wallet";
import { StatCard, AddressBadge, StatusChip, truncate, Spinner } from "../components/ui";
import PoofSparkle from "../components/PoofSparkle";
import PoofLottie from "../components/fx/PoofLottie";
import { EXPLORER_TX } from "../lib/types";
import { CURRENCIES, currencyById, fromBaseUnits, formatAmount } from "../lib/currencies";
import { analyzePrivacy } from "../lib/privacyScore";

export default function Dashboard() {
  const s = useWallet();
  const balances = s.balancesByCurrency ?? {};
  const heldCurrencies = CURRENCIES.filter((c) => (balances[c.id] ?? 0n) > 0n);
  const hero = heldCurrencies.find((c) => c.id === 0) ?? heldCurrencies[0] ?? currencyById(0);
  const otherHeld = heldCurrencies.filter((c) => c.id !== hero.id);

  const [showPoof, setShowPoof] = useState(false);

  useEffect(() => {
    s.refreshFeeBalance().catch(() => {});
    s.syncChain().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const triggerPoof = () => {
    setShowPoof(true);
    setTimeout(() => setShowPoof(false), 900);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-poof-lavender/15 grid place-items-center">
            <svg className="h-5 w-5 text-poof-lavender" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12l9-9 9 9M5 10v10h14V10"/></svg>
          </div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
        </div>
        <button onClick={() => s.syncChain()} className="btn-ghost text-sm" disabled={s.syncing}>
          {s.syncing ? <Spinner className="h-4 w-4" /> : "↻"} Sync
        </button>
      </div>

      <div
        onClick={triggerPoof}
        className="card card-glow p-7 border-poof-lavender/20 bg-gradient-to-br from-poof-lavender/15 via-poof-card to-poof-gold/5 relative overflow-hidden cursor-pointer active:scale-[0.995] transition"
        title="Poof! Click for the sparkle"
      >
        <span className="smoke-wisp h-16 w-16 right-8 top-2 animate-smoke-rise" />
        <PoofSparkle active={showPoof} count={26} className="" />
        <div className="text-sm text-poof-muted flex items-center gap-1.5">Shielded balance <span className="text-poof-gold/70">·</span> <span className="text-[11px] text-poof-muted/70">tap to poof</span></div>
        <div data-testid="balance" className="text-5xl font-bold tabular-nums mt-1">
          <span className="text-magic">{fromBaseUnits(balances[hero.id] ?? 0n, hero.decimals)}</span> <span className="text-2xl text-poof-muted">{hero.symbol}</span>
        </div>
        {otherHeld.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2" data-testid="balance-breakdown">
            {otherHeld.map((c) => (
              <span key={c.id} className="rounded-full bg-poof-gold/10 px-3 py-1 text-sm tabular-nums">
                {fromBaseUnits(balances[c.id] ?? 0n, c.decimals)} {c.symbol}
              </span>
            ))}
          </div>
        )}
        <div className="mt-4 flex flex-wrap gap-3">
          <Link to="/app/deposit" className="btn-primary">Deposit</Link>
          <Link to="/app/send" className="btn-ghost">Send</Link>
          <Link to="/app/receive" className="btn-ghost">Receive</Link>
        </div>
        <div className="absolute bottom-3 right-4 text-[10px] text-poof-gold/70 select-none">poof</div>
      </div>

      {/* Privacy mini-gauge */}
      {(() => {
        const pr = analyzePrivacy(s.notes, s.nextLeafIndex ?? 0, s.txs);
        const color = pr.score >= 70 ? "#34d399" : pr.score >= 40 ? "#fbbf24" : "#f87171";
        return (
          <Link to="/app/privacy" className="card glow-ring p-4 flex items-center gap-4 group transition hover:border-poof-lavender/40">
            <div className="relative h-12 w-12 shrink-0">
              <svg viewBox="0 0 40 40" className="h-12 w-12 -rotate-90">
                <circle cx="20" cy="20" r="16" fill="none" stroke="currentColor" strokeWidth="3" className="text-poof-border/40" />
                <circle cx="20" cy="20" r="16" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round"
                  strokeDasharray={100.5} strokeDashoffset={100.5 - (pr.score / 100) * 100.5}
                  style={{ filter: `drop-shadow(0 0 4px ${color}60)` }} />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-xs font-bold" style={{ color }}>{pr.score}</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium flex items-center gap-2">
                Privacy Score
                <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: `${color}18`, color }}>{pr.grade}</span>
              </div>
              <div className="text-xs text-poof-muted mt-0.5 truncate">
                {pr.recommendations[0]?.text ?? "Tap for details"}
              </div>
            </div>
            <svg className="h-4 w-4 text-poof-muted group-hover:text-poof-text transition shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
          </Link>
        );
      })()}

      <div className="grid sm:grid-cols-3 gap-4">
        <StatCard label="Notes" value={s.notes.filter((n) => !n.spent && !n.invalidReason).length} sub={`${s.notes.length} total`} />
        <StatCard label="Tree leaves" value={s.nextLeafIndex ?? "—"} sub="commitments on-chain" />
        <StatCard label="Current root" value={<span className="mono text-base">{s.currentRoot ? truncate(s.currentRoot, 6, 4) : "—"}</span>} sub="depth-20 Merkle" />
      </div>

      <div className="card glow-ring p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="font-medium">Your Poof address</div>
          <Link to="/app/receive" className="text-sm text-poof-gold hover:underline">Show full ↗</Link>
        </div>
        {s.address && <AddressBadge value={s.address.pubkey} label="pubkey" testid="dash-address" />}
      </div>

      {/* Private messages mini-widget */}
      {(() => {
        const withMemos = s.notes.filter((n) => n.memo && !n.spent).slice(0, 3);
        if (withMemos.length === 0) return null;
        return (
          <div className="card p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 font-medium">
                <svg className="h-4 w-4 text-poof-lavender" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
                </svg>
                Private messages
              </div>
              <Link to="/app/receive" className="text-xs text-poof-muted hover:text-poof-text">View all</Link>
            </div>
            <div className="divide-y divide-poof-border/50">
              {withMemos.map((n, i) => (
                <div key={i} className="py-2 flex items-start gap-3">
                  <span className="text-xs text-poof-muted shrink-0 tabular-nums">{formatAmount(n.note.amount, n.note.currencyId)}</span>
                  <span className="text-sm text-poof-text truncate flex-1 italic">{n.memo}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">Recent activity</h2>
          <Link to="/app/activity" className="text-sm text-poof-muted hover:text-poof-text">View all</Link>
        </div>
        {s.txs.length === 0 ? (
          <div className="card p-8 text-center text-poof-muted text-sm flex flex-col items-center gap-2">
            <PoofLottie name="bored" className="h-24 w-24" />
            <span>Nothing up our sleeve yet. Deposit to mint your first private note.</span>
          </div>
        ) : (
          <div className="card divide-y divide-poof-border">
            {s.txs.slice(0, 5).map((t) => (
              <div key={t.id} className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className={`h-2 w-2 rounded-full shrink-0 ${t.kind === "deposit" ? "bg-poof-success" : t.kind === "withdraw" ? "bg-poof-gold" : t.kind === "transfer" ? "bg-poof-lavender" : "bg-poof-accent"}`} />
                  <span className="capitalize font-medium">{t.kind}</span>
                  <StatusChip status={t.status} />
                </div>
                <div className="flex items-center gap-4">
                  <span className="tabular-nums">{formatAmount(t.amount, t.currencyId)}</span>
                  {t.hash && <a href={EXPLORER_TX + t.hash} target="_blank" rel="noreferrer" className="text-xs text-poof-gold hover:underline">{truncate(t.hash, 6, 4)} ↗</a>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
