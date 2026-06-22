import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { motion, type Variants } from "framer-motion";
import CountUp from "react-countup";
import {
  ArrowDownToLine,
  Send,
  ArrowUpFromLine,
  Inbox,
  ShieldCheck,
  EyeOff,
  Layers,
  ArrowRight,
  Sparkles,
  LockKeyhole,
  Globe,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import MagicTextReveal from "../components/fx/MagicTextReveal";
import PoofSparkle from "../components/PoofSparkle";
import PoofLottie from "../components/fx/PoofLottie";
import "../styles/landing.css";

/* ── tiny Poof mark ──────────────────────────────────────────────────────── */
function Mark({ size = 22, color = "#E8D5A3" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
      <path
        d="M9.5 20.5c-2.8 0-4.5-1.9-4.2-4.3.2-1.9 1.8-3.2 3.6-3.2.2-2.6 2.3-4.7 5-4.7 1.9 0 3.6 1 4.5 2.6.6-.4 1.4-.6 2.2-.6 2.3 0 4.1 1.8 4.1 4.1 0 .3 0 .6-.1.9 1.5.4 2.6 1.8 2.6 3.4 0 1.9-1.6 3.5-3.6 3.5H9.5Z"
        stroke={color} strokeWidth="1.6" strokeLinejoin="round"
      />
      <path d="M15 9.5c1-1.1.6-2.4-.3-3.1-.9-.7-1.1-1.6-.4-2.6" stroke={color} strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

/* ── framer-motion: scroll-reveal helper ─────────────────────────────────── */
const reveal: Variants = {
  hidden: { opacity: 0, y: 24 },
  show: (i = 0) => ({
    opacity: 1, y: 0,
    transition: { duration: 0.6, delay: i * 0.08, ease: [0.22, 1, 0.36, 1] },
  }),
};
const Reveal = motion.div;

const HEX = "0123456789abcdef";
const rhex = (n: number) => Array.from({ length: n }, () => HEX[(Math.random() * 16) | 0]).join("");
const ri = (a: number, b: number) => a + Math.floor(Math.random() * (b - a));

/** Lines for the data panel — what Poof publishes (opaque) vs a public ledger (readable). */
function streamLine(mode: "private" | "public"): string {
  if (mode === "private") {
    const kinds = [
      () => `cm   0x${rhex(8)}…${rhex(4)}`,
      () => `nf   0x${rhex(8)}…${rhex(4)}`,
      () => `root 0x${rhex(10)}`,
      () => `leaf #${ri(1000, 99999)}`,
      () => `π    groth16 ✓`,
      () => `tag  0x${rhex(2)}`,
    ];
    return kinds[(Math.random() * kinds.length) | 0]();
  }
  const amt = (Math.random() * 5000).toFixed(2);
  const kinds = [
    () => `G${rhex(4).toUpperCase()}… → G${rhex(4).toUpperCase()}…  ${amt} XLM`,
    () => `balance  G${rhex(4).toUpperCase()}…  ${amt}`,
    () => `payment  ${amt} XLM  memo:"rent"`,
    () => `acct G${rhex(5).toUpperCase()}  seq ${ri(10000, 99999)}`,
  ];
  return kinds[(Math.random() * kinds.length) | 0]();
}

const NAV_SECTIONS = [
  { id: "how", label: "How it works" },
  { id: "private", label: "Privacy" },
  { id: "honest", label: "What's real" },
];

const FEATURES = [
  { Icon: ArrowDownToLine, t: "Deposit", d: "Shield public XLM into the pool." },
  { Icon: Send, t: "Send", d: "Transfer privately — amount and recipient hidden." },
  { Icon: ArrowUpFromLine, t: "Withdraw", d: "Unshield to any Stellar account." },
  { Icon: Inbox, t: "Receive", d: "Discover incoming notes with your viewing key." },
];

const PILLARS = [
  { Icon: ShieldCheck, t: "Zero-knowledge proofs", d: "Every spend is a Groth16 proof, verified on-chain before anything moves." },
  { Icon: EyeOff, t: "Unlinkable nullifiers", d: "Each note yields one one-time tag — double-spends are impossible." },
  { Icon: Layers, t: "Sealed notes", d: "Poseidon commitments hide every value, owner, and currency." },
];

const STATS: { end: number; prefix?: string; suffix?: string; decimals?: number; label: string }[] = [
  { end: 5, suffix: "s", label: "Average settlement time" },
  { end: 0.00001, prefix: "$", decimals: 5, label: "Average cost per transaction" },
  { end: 90, suffix: "+", label: "Countries with cash on/off ramps" },
  { end: 203, prefix: "$", suffix: "M", label: "Network value locked, and counting" },
];

export default function Landing() {
  const [mode, setMode] = useState<"private" | "public">("private");

  const columns = useMemo(
    () =>
      Array.from({ length: 10 }, () => ({
        dur: 18 + Math.random() * 22,
        lines: Array.from({ length: 28 }, () => streamLine(mode)),
      })),
    [mode]
  );

  return (
    <div className="poof-landing">
      {/* ── Nav ─────────────────────────────────────────────────────────── */}
      <nav className="pl-nav">
        <div className="pl-container pl-nav-inner">
          <Link to="/" className="pl-wordmark">
            <Mark />
            <span>poof</span>
          </Link>
          <div className="pl-nav-links">
            {NAV_SECTIONS.map((s) => (
              <a key={s.id} href={`#${s.id}`} className="pl-navlink">{s.label}</a>
            ))}
            <a
              className="pl-navlink"
              href="https://developers.stellar.org/docs/build/smart-contracts/overview"
              target="_blank" rel="noreferrer"
            >Docs</a>
          </div>
          <div className="pl-nav-actions">
            <a className="pl-btn pl-btn-ghost" href="https://github.com/ManulParihar/Poof" target="_blank" rel="noreferrer">GitHub</a>
            <Link className="pl-btn pl-btn-orange" to="/app">Launch App</Link>
          </div>
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <header className="pl-container pl-hero">
        <div className="pl-orb pl-orb-gold" />
        <div className="pl-orb pl-orb-lav" />
        <div className="pl-orb pl-orb-pink" />

        <motion.div className="pl-hero-meta" variants={reveal} initial="hidden" animate="show">
          <span className="pl-tag"><span className="pl-tag-dot" />Built on Stellar · Soroban</span>
          <span className="pl-tag">Zero-knowledge · Testnet</span>
        </motion.div>

        {/* particle wordmark — condenses on hover, "poofs" apart again */}
        <motion.div
          className="pl-hero-mark"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        >
          <PoofSparkle active count={26} />
          <MagicTextReveal text="poof" fontSize={120} fontWeight={800} color="rgba(232, 213, 163, 1)" spread={46} />
        </motion.div>

        <motion.h1 className="pl-h1" variants={reveal} initial="hidden" animate="show" custom={1}>
          Make value <span className="pl-emph-orange">disappear</span>.
        </motion.h1>
        <motion.p className="pl-sub" variants={reveal} initial="hidden" animate="show" custom={2}>
          Private payments on Stellar — balances, amounts, and recipients sealed
          behind on-chain zero-knowledge proofs.
        </motion.p>
        <motion.div className="pl-hero-actions" variants={reveal} initial="hidden" animate="show" custom={3}>
          <Link className="pl-btn pl-btn-orange" to="/app">Launch App <ArrowRight size={16} /></Link>
          <a className="pl-btn pl-btn-dark" href="#how">How it works</a>
        </motion.div>
      </header>

      {/* ── Data panel: Private vs Public ledger ─────────────────────────── */}
      <section className="pl-datapanel">
        <div className="pl-streams">
          {columns.map((c, i) => (
            <div key={i} className="pl-stream" style={{ animationDuration: `${c.dur}s` }}>
              {[...c.lines, ...c.lines].map((l, j) => <div key={j}>{l}</div>)}
            </div>
          ))}
        </div>
        <div className="pl-datapanel-center">
          <span className="pl-datapanel-pill">
            {mode === "private" ? "What Poof publishes on-chain" : "What a transparent ledger leaks"}
          </span>
          <div className="pl-toggle" role="tablist" aria-label="ledger view">
            <button data-active={mode === "private"} onClick={() => setMode("private")}>Private</button>
            <button data-active={mode === "public"} onClick={() => setMode("public")}>Public</button>
          </div>
          <span className="pl-datapanel-note">
            {mode === "private"
              ? "commitments · nullifiers · roots — unlinkable"
              : "addresses · amounts · memos — fully exposed"}
          </span>
        </div>
      </section>

      {/* ── Stats ─────────────────────────────────────────────────────────── */}
      <section className="pl-container pl-section" id="stellar">
        <div className="pl-eyebrow">Powered by Stellar</div>
        <h2 className="pl-h2">Settles like <span className="pl-emph-blue">cash</span>, not crypto.</h2>
        <div className="pl-stats">
          {STATS.map((s, i) => (
            <Reveal className="pl-stat" key={s.label} variants={reveal} initial="hidden" whileInView="show" viewport={{ once: true }} custom={i}>
              <div className="pl-stat-num">
                <CountUp
                  end={s.end}
                  prefix={s.prefix}
                  suffix={s.suffix}
                  decimals={s.decimals ?? 0}
                  duration={2.2}
                  enableScrollSpy
                  scrollSpyOnce
                />
              </div>
              <div className="pl-stat-label">{s.label}</div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── How it works ──────────────────────────────────────────────────── */}
      <section className="pl-container pl-section" id="how">
        <div className="pl-eyebrow">The flow</div>
        <h2 className="pl-h2">Four moves. The chain never sees a value.</h2>
        <div className="pl-grid-4">
          {FEATURES.map((f, i) => (
            <Reveal className="pl-feature" key={f.t} variants={reveal} initial="hidden" whileInView="show" viewport={{ once: true }} custom={i}>
              <div className="pl-icon"><f.Icon size={22} /></div>
              <div className="pl-feature-index">0{i + 1}</div>
              <h3 className="pl-feature-title">{f.t}</h3>
              <p className="pl-feature-body">{f.d}</p>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── Privacy pillars ───────────────────────────────────────────────── */}
      <section className="pl-container pl-section" id="private">
        <div className="pl-eyebrow">The load-bearing cryptography</div>
        <h2 className="pl-h2">The proof is the <span className="pl-emph-blue">authority</span>.</h2>
        <div className="pl-grid-3">
          {PILLARS.map((f, i) => (
            <Reveal className="pl-feature" key={f.t} variants={reveal} initial="hidden" whileInView="show" viewport={{ once: true }} custom={i}>
              <div className="pl-icon"><f.Icon size={22} /></div>
              <h3 className="pl-feature-title">{f.t}</h3>
              <p className="pl-feature-body">{f.d}</p>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── Honest disclosure ─────────────────────────────────────────────── */}
      <section className="pl-container pl-section" id="honest">
        <div className="pl-eyebrow">No smoke, no mirrors (well — some smoke)</div>
        <h2 className="pl-h2">Honest by design.</h2>
        <div className="pl-grid-3">
          <Reveal variants={reveal} initial="hidden" whileInView="show" viewport={{ once: true }} custom={0}>
            <div className="pl-disclosure-title pl-emph-blue">Real &amp; load-bearing</div>
            {["Groth16 verification on-chain", "Range checks + value conservation", "Nullifier double-spend prevention", "Merkle tree + root history"].map((x) => (
              <div className="pl-disclosure-item" key={x}>{x}</div>
            ))}
          </Reveal>
          <Reveal variants={reveal} initial="hidden" whileInView="show" viewport={{ once: true }} custom={1}>
            <div className="pl-disclosure-title">On the roadmap</div>
            {["Multi-party trusted-setup ceremony", "Viewing-key delegation for auditors", "Automatic on-chain note discovery", "Relayers for full fee privacy"].map((x) => (
              <div className="pl-disclosure-item" key={x}>{x}</div>
            ))}
          </Reveal>
          <Reveal variants={reveal} initial="hidden" whileInView="show" viewport={{ once: true }} custom={2}>
            <div className="pl-disclosure-title pl-emph-orange">Known leaks</div>
            {["Fee-payer is visible (relayers next)", "Small anonymity set on a demo pool", "No audit yet — research-grade"].map((x) => (
              <div className="pl-disclosure-item" key={x}>{x}</div>
            ))}
          </Reveal>
        </div>
      </section>

      {/* ── CTA band ──────────────────────────────────────────────────────── */}
      <section className="pl-cta">
        <div className="pl-container" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 24 }}>
          <div>
            <h2 className="pl-h2" style={{ fontSize: 30 }}>Ready to make value disappear?</h2>
            <p className="pl-body" style={{ marginTop: 8 }}>Spin up a shielded identity in seconds. Testnet only — bring play money.</p>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Link className="pl-btn pl-btn-orange" to="/app">Launch App <ArrowRight size={16} /></Link>
            <Link className="pl-btn pl-btn-ghost" to="/app/welcome">Create identity</Link>
          </div>
        </div>
      </section>

      {/* ── Animated footer band ──────────────────────────────────────────── */}
      <section className="pl-band">
        <div className="pl-band-glow" />
        {/* floating brand icons drifting across the band */}
        {([
          [LockKeyhole, "12%", 0],
          [ShieldCheck, "28%", 0.6],
          [Sparkles, "46%", 1.2],
          [Globe, "64%", 0.3],
          [Wand2, "82%", 0.9],
        ] as [LucideIcon, string, number][]).map(([Icon, left, delay], i) => (
          <motion.div
            key={i}
            className="pl-band-icon"
            style={{ left }}
            animate={{ y: [0, -16, 0], opacity: [0.35, 0.8, 0.35] }}
            transition={{ duration: 5 + i, repeat: Infinity, ease: "easeInOut", delay }}
          >
            <Icon size={26} />
          </motion.div>
        ))}

        <motion.div
          className="pl-band-lottie"
          initial={{ opacity: 0, scale: 0.8 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        >
          <PoofLottie name="transfer" className="h-28 w-28" />
        </motion.div>

        <motion.div
          className="pl-band-title"
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
        >
          poof — <span className="pl-emph-orange">private by construction</span>
        </motion.div>
      </section>

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <footer className="pl-container pl-footer">
        <div className="pl-footer-cols">
          <div>
            <Link to="/" className="pl-wordmark" style={{ marginBottom: 12 }}>
              <Mark />
              <span>poof</span>
            </Link>
            <p className="pl-feature-body" style={{ maxWidth: 240 }}>
              A UTXO-style private payment protocol on Stellar / Soroban.
            </p>
          </div>
          <div>
            <h4 className="pl-footer-head">Product</h4>
            <Link className="pl-footer-link" to="/app">Dashboard</Link>
            <Link className="pl-footer-link" to="/app/deposit">Deposit</Link>
            <Link className="pl-footer-link" to="/app/send">Send</Link>
            <Link className="pl-footer-link" to="/app/withdraw">Withdraw</Link>
            <Link className="pl-footer-link" to="/app/receive">Receive</Link>
          </div>
          <div>
            <h4 className="pl-footer-head">Protocol</h4>
            <a className="pl-footer-link" href="#private">ZK circuit</a>
            <a className="pl-footer-link" href="#private">Merkle tree</a>
            <a className="pl-footer-link" href="#private">Nullifiers</a>
            <a className="pl-footer-link" href="#honest">Honest README</a>
          </div>
          <div>
            <h4 className="pl-footer-head">Stellar</h4>
            <a className="pl-footer-link" href="https://stellar.org" target="_blank" rel="noreferrer">stellar.org</a>
            <a className="pl-footer-link" href="https://developers.stellar.org/docs/build/smart-contracts/overview" target="_blank" rel="noreferrer">Soroban docs</a>
            <a className="pl-footer-link" href="https://stellar.expert/explorer/testnet" target="_blank" rel="noreferrer">Stellar Expert</a>
          </div>
          <div>
            <h4 className="pl-footer-head">Connect</h4>
            <a className="pl-footer-link" href="https://github.com/ManulParihar/Poof" target="_blank" rel="noreferrer">GitHub</a>
            <a className="pl-footer-link" href="https://developers.stellar.org" target="_blank" rel="noreferrer">Developer docs</a>
          </div>
        </div>
        <div className="pl-footer-bottom">
          <span className="pl-status"><span className="pl-status-dot" />Testnet · All systems operational</span>
          <span className="pl-copy">© 2026 Poof · Built on Stellar</span>
        </div>
      </footer>
    </div>
  );
}
