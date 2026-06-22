import { useEffect, useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { motion, type Variants } from "framer-motion";
import { PieChart, PieArcSeries } from "reaviz";
import {
  ShieldCheck,
  LayoutGrid,
  Lightbulb,
  Shuffle,
  ChartPie,
  Wallet,
  ScanEye,
} from "lucide-react";
import { useWallet } from "../store/wallet";
import { analyzePrivacy, type PrivacyFactor, type Recommendation } from "../lib/privacyScore";
import { Spinner } from "../components/ui";
import PoofSparkle from "../components/PoofSparkle";
import PoofLottie from "../components/fx/PoofLottie";
import { formatAmount } from "../lib/currencies";

const fade: Variants = {
  hidden: { opacity: 0, y: 18 },
  show: (i = 0) => ({ opacity: 1, y: 0, transition: { duration: 0.5, delay: i * 0.08, ease: [0.22, 1, 0.36, 1] } }),
};

const GRADE_COPY: Record<string, string> = {
  Strong: "Your value is well-mixed — observers can't link your notes back to you.",
  Good: "Solid privacy. A couple of small habits would tighten it further.",
  Fair: "Decent, but patterns are starting to show. Consider remixing notes.",
  Weak: "Your activity is becoming linkable. Remix notes to break the trail.",
};

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
  const strongCount = report.factors.filter((f) => f.level === "good").length;

  // Value concentration by risk bucket — drives the donut.
  const { donut, donutColors } = useMemo(() => {
    let safe = 0, round = 0, dominant = 0;
    for (const n of unspent) {
      const isDominant = total > 0n && (n.note.amount * 100n) / total > 60n;
      const v = Number(n.note.amount);
      if (isDominant) dominant += v;
      else if (isRoundish(n.note.amount)) round += v;
      else safe += v;
    }
    const raw = [
      { key: "Well-mixed", data: safe, color: "#34d399" },
      { key: "Round value", data: round, color: "#fbbf24" },
      { key: "Concentrated", data: dominant, color: "#f87171" },
    ].filter((d) => d.data > 0);
    return { donut: raw.map(({ key, data }) => ({ key, data })), donutColors: raw.map((d) => d.color) };
  }, [unspent, total]);

  if (!ready && s.syncing) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner className="h-8 w-8 text-poof-lavender" />
      </div>
    );
  }

  const scoreCol = scoreColor(report.score);

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div className="flex items-center gap-3" variants={fade} initial="hidden" animate="show">
        <div className="h-10 w-10 rounded-xl bg-poof-lavender/15 grid place-items-center">
          <ShieldCheck className="h-5 w-5 text-poof-lavender" />
        </div>
        <div>
          <h1 className="text-2xl font-bold leading-tight">Privacy</h1>
          <p className="text-xs text-poof-muted">How linkable your shielded activity looks on-chain.</p>
        </div>
      </motion.div>

      {/* Hero: score ring + grade narrative */}
      <motion.div
        className="card card-glow relative overflow-hidden p-6 sm:p-8"
        variants={fade} initial="hidden" animate="show" custom={1}
      >
        <div
          className="pointer-events-none absolute -top-24 -right-24 h-72 w-72 rounded-full blur-3xl"
          style={{ background: `radial-gradient(circle, ${scoreCol}22, transparent 70%)` }}
        />
        <div className="relative flex flex-col sm:flex-row items-center gap-8">
          <div className="relative shrink-0">
            {report.score >= 85 && <PoofSparkle active count={22} />}
            <ScoreRing score={report.score} grade={report.grade} />
          </div>
          <div className="flex-1 text-center sm:text-left">
            <div className="text-xs uppercase tracking-wide text-poof-muted mb-1">Privacy grade</div>
            <div className="text-3xl font-bold" style={{ color: scoreCol }}>{report.grade}</div>
            <p className="text-sm text-poof-muted mt-2 max-w-md">{GRADE_COPY[report.grade] ?? ""}</p>
            <div className="flex flex-wrap gap-2 mt-4 justify-center sm:justify-start">
              <Chip icon={<Wallet className="h-3.5 w-3.5" />} label={`${formatAmount(total, 0)} shielded`} />
              <Chip icon={<ScanEye className="h-3.5 w-3.5" />} label={`${unspent.length} unspent notes`} />
              <Chip icon={<ShieldCheck className="h-3.5 w-3.5" />} label={`${strongCount}/${report.factors.length} factors strong`} />
            </div>
          </div>
        </div>
      </motion.div>

      {/* Factor Grid */}
      <motion.div className="grid sm:grid-cols-2 gap-3" variants={fade} initial="hidden" animate="show" custom={2}>
        {report.factors.map((f, i) => (
          <FactorCard key={f.name} factor={f} delay={i * 80} />
        ))}
      </motion.div>

      {/* Note distribution: donut + map */}
      {unspent.length > 0 ? (
        <motion.div className="grid lg:grid-cols-5 gap-4" variants={fade} initial="hidden" animate="show" custom={3}>
          {/* Donut — value concentration */}
          <div className="card p-5 lg:col-span-2">
            <SectionHead icon={<ChartPie className="h-4 w-4 text-poof-lavender" />} title="Value Concentration" />
            <div className="flex items-center justify-center h-[180px]">
              <PieChart
                width={180}
                height={180}
                data={donut}
                series={<PieArcSeries doughnut colorScheme={donutColors} />}
              />
            </div>
            <div className="flex flex-col gap-1.5 mt-3">
              {donut.map((d, i) => (
                <div key={d.key} className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-2 text-poof-muted">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ background: donutColors[i] }} />
                    {d.key}
                  </span>
                  <span className="tabular-nums text-poof-text">
                    {total > 0n ? Math.round((d.data / Number(total)) * 100) : 0}%
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Note map */}
          <div className="card p-5 lg:col-span-3">
            <SectionHead
              icon={<LayoutGrid className="h-4 w-4 text-poof-lavender" />}
              title="Note Map"
              right={<span className="text-xs text-poof-muted">{unspent.length} unspent</span>}
            />
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 auto-rows-[58px]">
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
        </motion.div>
      ) : (
        <motion.div className="card p-8 flex flex-col items-center text-center" variants={fade} initial="hidden" animate="show" custom={3}>
          <PoofLottie name="transfer" className="h-24 w-24" />
          <div className="text-sm font-medium mt-2">No shielded notes yet</div>
          <p className="text-xs text-poof-muted mt-1 max-w-xs">Deposit or receive value to start building a private balance — your privacy score grows as you mix.</p>
          <Link to="/app/deposit" className="btn-primary text-sm px-4 py-2 mt-4">Deposit →</Link>
        </motion.div>
      )}

      {/* Recommendations */}
      {report.recommendations.length > 0 && (
        <motion.div className="card p-5" variants={fade} initial="hidden" animate="show" custom={4}>
          <SectionHead icon={<Lightbulb className="h-4 w-4 text-poof-gold" />} title="Suggestions" />
          <div className="divide-y divide-poof-border/50">
            {report.recommendations.map((r, i) => (
              <RecommendationPill key={i} rec={r} />
            ))}
          </div>
        </motion.div>
      )}

      {/* Remix CTA */}
      <motion.div className="card glow-ring p-5 flex items-center justify-between" variants={fade} initial="hidden" animate="show" custom={5}>
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-poof-gold/15 grid place-items-center">
            <Shuffle className="h-4 w-4 text-poof-gold" />
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
      </motion.div>
    </div>
  );
}

function Chip({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-poof-text bg-poof-surface border border-poof-border rounded-full px-3 py-1.5">
      <span className="text-poof-lavender">{icon}</span>
      {label}
    </span>
  );
}

function SectionHead({ icon, title, right }: { icon: React.ReactNode; title: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      {icon}
      <span className="text-sm font-medium">{title}</span>
      {right && <span className="ml-auto">{right}</span>}
    </div>
  );
}
