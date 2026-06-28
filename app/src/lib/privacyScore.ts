import type { StoredNote, TxRecord } from "./types";

export interface PrivacyFactor {
  name: string;
  icon: "shield" | "fingerprint" | "clock" | "layers";
  score: number;
  maxScore: number;
  level: "good" | "warn" | "danger";
  detail: string;
}

export interface Recommendation {
  severity: "info" | "warn" | "action";
  text: string;
  actionLabel?: string;
  actionType?: "split" | "wait" | "deposit";
}

export interface PrivacyReport {
  score: number;
  grade: "Strong" | "Good" | "Fair" | "Weak" | "Critical";
  factors: PrivacyFactor[];
  recommendations: Recommendation[];
}

const ROUND_NUMBERS = [1, 5, 10, 50, 100, 500, 1000];
const STROOPS = 10_000_000n;

function level(score: number, max: number): "good" | "warn" | "danger" {
  const pct = score / max;
  if (pct >= 0.7) return "good";
  if (pct >= 0.4) return "warn";
  return "danger";
}

function anonymitySet(nextLeafIndex: number): PrivacyFactor {
  const score = Math.min(25, Math.round((nextLeafIndex / 500) * 25));
  const detail = nextLeafIndex === 0
    ? "Empty pool — no anonymity"
    : `${nextLeafIndex} commitments in pool`;
  return { name: "Anonymity Set", icon: "shield", score, maxScore: 25, level: level(score, 25), detail };
}

function valueFingerprint(notes: StoredNote[]): PrivacyFactor {
  const unspent = notes.filter((n) => !n.spent && !n.invalidReason);
  if (unspent.length === 0) return { name: "Value Fingerprint", icon: "fingerprint", score: 25, maxScore: 25, level: "good", detail: "No notes to fingerprint" };

  let score = 25;
  const total = unspent.reduce((s, n) => s + n.note.amount, 0n);
  let roundCount = 0;
  let dominant = false;

  for (const n of unspent) {
    const val = Number(n.note.amount) / Number(STROOPS);
    for (const r of ROUND_NUMBERS) {
      if (Math.abs(val - r) / r < 0.05) { roundCount++; break; }
    }
    if (total > 0n && (n.note.amount * 100n) / total > 60n) dominant = true;
  }

  score -= roundCount * 8;
  if (dominant) score -= 10;
  score = Math.max(0, score);

  const detail = dominant
    ? "One note holds >60% of balance"
    : roundCount > 0
    ? `${roundCount} note${roundCount > 1 ? "s" : ""} near round values`
    : "Values look non-obvious";

  return { name: "Value Fingerprint", icon: "fingerprint", score, maxScore: 25, level: level(score, 25), detail };
}

function timingCorrelation(txs: TxRecord[]): PrivacyFactor {
  let score = 25;
  let correlations = 0;

  const deposits = txs.filter((t) => t.kind === "deposit" && t.status === "success");
  const withdrawals = txs.filter((t) => t.kind === "withdraw" && t.status === "success");
  // a self-send is indistinguishable from an outbound transfer to an adversary, so
  // it carries the same timing-correlation signature — count both kinds.
  const sends = txs.filter((t) => (t.kind === "transfer" || t.kind === "self") && t.status === "success");

  for (const d of deposits) {
    for (const w of withdrawals) {
      const dt = Math.abs(d.createdAt - w.createdAt);
      const amtRatio = Number(d.amount) / Math.max(1, Number(w.amount));
      if (dt < 15 * 60 * 1000 && amtRatio > 0.8 && amtRatio < 1.2) {
        correlations++;
      }
    }
    for (const s of sends) {
      if (Math.abs(d.createdAt - s.createdAt) < 5 * 60 * 1000) {
        correlations++;
      }
    }
  }

  score -= correlations * 12;
  score = Math.max(0, score);

  const detail = correlations > 0
    ? `${correlations} correlated tx pair${correlations > 1 ? "s" : ""} detected`
    : "No timing correlations found";

  return { name: "Timing", icon: "clock", score, maxScore: 25, level: level(score, 25), detail };
}

function utxoShape(notes: StoredNote[]): PrivacyFactor {
  const unspent = notes.filter((n) => !n.spent && !n.invalidReason);
  const count = unspent.length;
  let score = 25;

  if (count === 0) return { name: "UTXO Shape", icon: "layers", score: 0, maxScore: 25, level: "danger", detail: "No unspent notes" };
  if (count === 1) score -= 15;
  else if (count === 2) score -= 5;
  else if (count > 8) score -= Math.min(15, (count - 8) * 3);

  const sorted = [...unspent].sort((a, b) => Number(b.note.amount - a.note.amount));
  const total = unspent.reduce((s, n) => s + n.note.amount, 0n);
  if (total > 0n && count > 2) {
    const top2 = sorted.slice(0, 2).reduce((s, n) => s + n.note.amount, 0n);
    if (top2 < total) score -= 10;
  }

  score = Math.max(0, score);

  const detail = count === 1
    ? "Single note — fully identifiable"
    : count <= 2
    ? `${count} notes — limited diversity`
    : count <= 8
    ? `${count} notes — healthy spread`
    : `${count} notes — consolidate dust`;

  return { name: "UTXO Shape", icon: "layers", score, maxScore: 25, level: level(score, 25), detail };
}

export function analyzePrivacy(
  notes: StoredNote[],
  nextLeafIndex: number,
  txs: TxRecord[]
): PrivacyReport {
  const factors: PrivacyFactor[] = [
    anonymitySet(nextLeafIndex),
    valueFingerprint(notes),
    timingCorrelation(txs),
    utxoShape(notes),
  ];

  const score = factors.reduce((s, f) => s + f.score, 0);
  const grade: PrivacyReport["grade"] =
    score >= 85 ? "Strong" : score >= 65 ? "Good" : score >= 45 ? "Fair" : score >= 25 ? "Weak" : "Critical";

  const recommendations: Recommendation[] = [];

  for (const f of factors) {
    if (f.icon === "shield" && f.score < 15) {
      recommendations.push({ severity: "info", text: "Pool is small — privacy grows with users" });
    }
    if (f.icon === "fingerprint" && f.score < 15) {
      recommendations.push({ severity: "action", text: "Split round-value notes via self-transfer", actionLabel: "Split", actionType: "split" });
    }
    if (f.icon === "clock" && f.score < 15) {
      recommendations.push({ severity: "warn", text: "Wait longer between deposit and spend" });
    }
    if (f.icon === "layers" && f.score < 10) {
      const unspent = notes.filter((n) => !n.spent && !n.invalidReason);
      if (unspent.length === 1) {
        recommendations.push({ severity: "action", text: "Split your single note into two", actionLabel: "Split", actionType: "split" });
      } else if (unspent.length > 8) {
        recommendations.push({ severity: "info", text: "Consolidate dust notes to reduce footprint" });
      }
    }
  }

  if (recommendations.length === 0 && score >= 65) {
    recommendations.push({ severity: "info", text: "Privacy posture looks healthy" });
  }

  return { score, grade, factors, recommendations };
}
