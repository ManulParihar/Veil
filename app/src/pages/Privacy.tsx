import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useWallet } from "../store/wallet";
import { analyzePrivacy, type PrivacyFactor, type Recommendation } from "../lib/privacyScore";
import { Spinner } from "../components/ui";
import { formatAmount } from "../lib/currencies";

const ROUND_NUMBERS = [1, 5, 10, 50, 100, 500, 1000];
const STROOPS = 10_000_000n;

function isRoundish(amount: bigint): boolean {
  const val = Number(amount) / Number(STROOPS);
  return ROUND_NUMBERS.some((r) => Math.abs(val - r) / r < 0.05);
}

function scoreColor(score: number): string {
  if (score >= 70) return "#34d399";
  if (score >= 40) return "#fbbf24";
  return "#f87171";
}

function gradeEmoji(grade: string): string {
  switch (grade) {
    case "Strong": return "✦";
    case "Good": return "◆";
    case "Fair": return "▲";
    case "Weak": return "●";
    default: return "⬥";
  }
}

function FactorIcon({ icon, className = "", style }: { icon: PrivacyFactor["icon"]; className?: string; style?: React.CSSProperties }) {
  const props = { className: `${className}`, style, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (icon) {
    case "shield":
      return <svg {...props}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" /><path d="M9 12l2 2 4-4" /></svg>;
    case "fingerprint":
      return <svg {...props}><path d="M2 12C2 6.5 6.5 2 12 2a10 10 0 018 4" /><path d="M5 19.5C5.5 18 6 15 6 12c0-3.3 2.7-6 6-6 1.8 0 3.4.8 4.5 2" /><path d="M12 12c0 4-1 8-3 10" /><path d="M12 12c0 5 1.5 8 4 10" /><path d="M18 12a6 6 0 00-6-6" /></svg>;
    case "clock":
      return <svg {...props}><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>;
    case "layers":
      return <svg {...props}><path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" /></svg>;
  }
}

function ScoreRing({ score, grade }: { score: number; grade: string }) {
  const r = 70;
  const c = 2 * Math.PI * r;
  const offset = c - (score / 100) * c;
  const color = scoreColor(score);

  return (
    <div className="relative flex items-center justify-center">
      <div className="absolute rounded-full animate-glow-pulse" style={{ width: 180, height: 180, background: `radial-gradient(circle, ${color}15, transparent 70%)` }} />
      <svg width="180" height="180" viewBox="0 0 160 160" className="relative -rotate-90">
        <circle cx="80" cy="80" r={r} fill="none" stroke="currentColor" strokeWidth="6" className="text-poof-border/40" />
        <circle
          cx="80" cy="80" r={r} fill="none"
          stroke={color} strokeWidth="6" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={offset}
          className="animate-score-fill drop-shadow-[0_0_8px_currentColor]"
          style={{ filter: `drop-shadow(0 0 6px ${color}80)` }}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-4xl font-bold tabular-nums" style={{ color }}>{score}</span>
        <span className="text-sm text-poof-muted flex items-center gap-1.5 mt-0.5">
          <span style={{ color }}>{gradeEmoji(grade)}</span> {grade}
        </span>
      </div>
    </div>
  );
}

function FactorCard({ factor, delay }: { factor: PrivacyFactor; delay: number }) {
  const colors = { good: "#34d399", warn: "#fbbf24", danger: "#f87171" };
  const color = colors[factor.level];
  const pct = (factor.score / factor.maxScore) * 100;

  return (
    <div
      className="card p-4 animate-fade-in"
      style={{ animationDelay: `${delay}ms`, borderLeft: `3px solid ${color}` }}
    >
      <div className="flex items-center gap-3 mb-3">
        <div className="h-9 w-9 rounded-lg grid place-items-center" style={{ background: `${color}18` }}>
          <FactorIcon icon={factor.icon} className="h-4.5 w-4.5" style={{ color }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{factor.name}</span>
            <span className="text-xs tabular-nums font-semibold" style={{ color }}>{factor.score}/{factor.maxScore}</span>
          </div>
        </div>
      </div>
      <div className="h-1.5 rounded-full bg-poof-surface overflow-hidden">
        <div
          className="h-full rounded-full animate-bar-fill origin-left"
          style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${color}90, ${color})`, boxShadow: `0 0 8px ${color}50` }}
        />
      </div>
      <div className="text-xs text-poof-muted mt-2">{factor.detail}</div>
    </div>
  );
}

function NoteBlock({ amount, currencyId, pct, risky, dominant }: { amount: bigint; currencyId: number; pct: number; risky: boolean; dominant: boolean }) {
  const bg = dominant ? "bg-poof-danger/20 border-poof-danger/40" : risky ? "bg-poof-warn/15 border-poof-warn/30" : "bg-poof-success/15 border-poof-success/30";
  const span = Math.max(1, Math.round(pct / 20));

  return (
    <div
      className={`rounded-xl border p-3 flex flex-col justify-center transition-all ${bg} ${risky || dominant ? "animate-pulse" : ""}`}
      style={{ gridRowEnd: `span ${span}` }}
    >
      <div className="text-sm font-semibold tabular-nums truncate">{formatAmount(amount, currencyId)}</div>
      <div className="text-[10px] text-poof-muted mt-0.5">
        {dominant ? "dominant" : risky ? "round value" : "safe"}
      </div>
    </div>
  );
}

function RecommendationPill({ rec }: { rec: Recommendation }) {
  const dotColor = rec.severity === "action" ? "bg-poof-accent" : rec.severity === "warn" ? "bg-poof-warn" : "bg-poof-lavender";
  return (
    <div className="flex items-center gap-2.5 py-1.5">
      <span className={`h-2 w-2 rounded-full shrink-0 ${dotColor}`} />
      <span className="text-sm text-poof-text flex-1">{rec.text}</span>
      {rec.actionLabel && (
        <Link to="/app/send" className="text-xs text-poof-gold hover:underline shrink-0">{rec.actionLabel} →</Link>
      )}
    </div>
  );
}

export default function Privacy() {
  const s = useWallet();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    s.syncChain().then(() => setReady(true)).catch(() => setReady(true));
  }, []);

  const report = analyzePrivacy(s.notes, s.nextLeafIndex ?? 0, s.txs);
  const unspent = s.notes.filter((n) => !n.spent && !n.invalidReason);
  const total = unspent.reduce((sum, n) => sum + n.note.amount, 0n);

  if (!ready && s.syncing) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner className="h-8 w-8 text-poof-lavender" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-poof-lavender/15 grid place-items-center">
          <svg className="h-5 w-5 text-poof-lavender" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold">Privacy</h1>
      </div>

      {/* Score Ring */}
      <div className="card card-glow p-8 flex flex-col items-center border-poof-border/40">
        <ScoreRing score={report.score} grade={report.grade} />
      </div>

      {/* Factor Grid */}
      <div className="grid sm:grid-cols-2 gap-3">
        {report.factors.map((f, i) => (
          <FactorCard key={f.name} factor={f} delay={i * 100} />
        ))}
      </div>

      {/* Note Treemap */}
      {unspent.length > 0 && (
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <svg className="h-4 w-4 text-poof-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M3 9h18M9 3v18" />
            </svg>
            <span className="text-sm font-medium">Note Map</span>
            <span className="text-xs text-poof-muted ml-auto">{unspent.length} unspent</span>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 auto-rows-[60px]">
            {unspent.map((n, i) => {
              const pct = total > 0n ? Number((n.note.amount * 100n) / total) : 0;
              const isDominant = total > 0n && (n.note.amount * 100n) / total > 60n;
              return (
                <NoteBlock
                  key={n.leafIndex ?? i}
                  amount={n.note.amount}
                  currencyId={n.note.currencyId}
                  pct={pct}
                  risky={isRoundish(n.note.amount)}
                  dominant={isDominant}
                />
              );
            })}
          </div>
          <div className="flex items-center gap-4 mt-3 text-[10px] text-poof-muted">
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-poof-success/40" /> safe</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-poof-warn/40" /> round value</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-poof-danger/40" /> dominant</span>
          </div>
        </div>
      )}

      {/* Recommendations */}
      {report.recommendations.length > 0 && (
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-3">
            <svg className="h-4 w-4 text-poof-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18h6M10 22h4M12 2v1M4.2 4.2l.7.7M1 12h1M21 12h1M19.1 4.9l-.7.7" />
              <path d="M12 6a6 6 0 014 10.5V18H8v-1.5A6 6 0 0112 6z" />
            </svg>
            <span className="text-sm font-medium">Suggestions</span>
          </div>
          <div className="divide-y divide-poof-border/50">
            {report.recommendations.map((r, i) => (
              <RecommendationPill key={i} rec={r} />
            ))}
          </div>
        </div>
      )}

      {/* Remix CTA */}
      <div className="card glow-ring p-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-poof-gold/15 grid place-items-center">
            <svg className="h-4 w-4 text-poof-gold" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.6-8.6c.8-1.1 2-1.7 3.3-1.7H22" />
              <path d="M18 2l4 4-4 4" />
              <path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2M22 18h-5.9c-1.3 0-2.5-.6-3.3-1.7l-.5-.7" />
              <path d="M18 14l4 4-4 4" />
            </svg>
          </div>
          <div>
            <div className="text-sm font-medium">Remix Notes</div>
            <div className="text-xs text-poof-muted">Self-transfer to break linkability</div>
          </div>
        </div>
        {report.score >= 85 ? (
          <span className="text-xs text-poof-success px-3 py-1.5 rounded-full bg-poof-success/10">Privacy is strong</span>
        ) : (
          <Link to="/app/send" className="btn-primary text-sm px-4 py-2">Remix →</Link>
        )}
      </div>
    </div>
  );
}
