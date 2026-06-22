import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import "../styles/landing.css";

/* ── tiny monochrome Poof mark for the editorial palette ────────────────── */
function Mark({ size = 22, color = "#181818" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
      <path
        d="M9.5 20.5c-2.8 0-4.5-1.9-4.2-4.3.2-1.9 1.8-3.2 3.6-3.2.2-2.6 2.3-4.7 5-4.7 1.9 0 3.6 1 4.5 2.6.6-.4 1.4-.6 2.2-.6 2.3 0 4.1 1.8 4.1 4.1 0 .3 0 .6-.1.9 1.5.4 2.6 1.8 2.6 3.4 0 1.9-1.6 3.5-3.6 3.5H9.5Z"
        stroke={color}
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M15 9.5c1-1.1.6-2.4-.3-3.1-.9-.7-1.1-1.6-.4-2.6"
        stroke={color}
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

const HEX = "0123456789abcdef";
const rhex = (n: number) => Array.from({ length: n }, () => HEX[(Math.random() * 16) | 0]).join("");
const ri = (a: number, b: number) => a + Math.floor(Math.random() * (b - a));

/** Lines for the schematic-blue data panel — toggled between what Poof publishes
 *  on-chain (opaque) and what a transparent ledger would leak (readable). */
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
  { id: "stellar", label: "Stellar" },
  { id: "honest", label: "What's real" },
];

const FEATURES = [
  {
    t: "Deposit",
    d: "Shield public testnet XLM into the pool. Your funds are custodied by one Soroban contract and re-minted as a private note — the amount visible only to you.",
  },
  {
    t: "Send",
    d: "A shielded transfer. The recipient and amount stay hidden; only an unlinkable nullifier and fresh commitments touch the chain.",
  },
  {
    t: "Withdraw",
    d: "Unshield to any Stellar account. The pool releases real XLM while your spend reveals nothing but a one-time nullifier.",
  },
  {
    t: "Receive",
    d: "Discover incoming notes by trial-decrypting on-chain ciphertexts with your viewing key — accelerated by a one-byte view tag.",
  },
];

const PRIVACY = [
  {
    t: "Groth16 on-chain",
    d: "Every spend carries a zero-knowledge proof, verified by the contract over BN254 before any state changes. Remove the proof and nothing moves.",
  },
  {
    t: "Poseidon Merkle tree",
    d: "Notes live as Poseidon commitments in a depth-20 incremental tree with a rolling root history, so in-flight proofs stay valid under concurrency.",
  },
  {
    t: "Nullifiers",
    d: "Each note yields exactly one unlinkable nullifier. Seen nullifiers are rejected forever — double-spends are impossible, archival-safe by design.",
  },
  {
    t: "Value conservation",
    d: "In-circuit range checks and a strict conservation equation mean no value is minted from nothing and the field can never wrap to fake a balance.",
  },
  {
    t: "Encrypted notes",
    d: "Output notes are sealed with X25519 + AEAD and emitted as events, so recipients find their money without anyone else learning a thing.",
  },
  {
    t: "Multi-currency pool",
    d: "One pool, many assets. Each note binds a currency id into its commitment, keeping every transaction single-asset and custody isolated per token.",
  },
];

export default function Landing() {
  const [mode, setMode] = useState<"private" | "public">("private");

  // 10 columns; regenerate the text only when the toggle flips.
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
              <a key={s.id} href={`#${s.id}`} className="pl-navlink">
                {s.label}
              </a>
            ))}
            <a
              className="pl-navlink"
              href="https://developers.stellar.org/docs/build/smart-contracts/overview"
              target="_blank"
              rel="noreferrer"
            >
              Docs
            </a>
          </div>
          <div className="pl-nav-actions">
            <a
              className="pl-btn pl-btn-ghost"
              href="https://github.com"
              target="_blank"
              rel="noreferrer"
            >
              GitHub
            </a>
            <Link className="pl-btn pl-btn-orange" to="/app">
              Launch App
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <header className="pl-container pl-hero">
        <div className="pl-hero-meta" style={{ marginTop: 0, marginBottom: 24 }}>
          <span className="pl-tag">
            <span className="pl-tag-dot" />
            Built on Stellar · Soroban
          </span>
          <span className="pl-tag">Zero-knowledge · Testnet</span>
        </div>
        <h1 className="pl-h1">
          Private payments on Stellar.
          <br />
          Make value <span className="pl-emph-orange">disappear</span> — the right way.
        </h1>
        <p className="pl-sub">
          Poof is a shielded pool on Stellar. Hold, send, and settle real value while
          balances, amounts, and recipients stay sealed behind on-chain zero-knowledge proofs.
        </p>
        <div className="pl-hero-actions">
          <Link className="pl-btn pl-btn-orange" to="/app">
            Launch App →
          </Link>
          <a
            className="pl-btn pl-btn-dark"
            href="#how"
          >
            How it works
          </a>
          <a
            className="pl-btn pl-btn-ghost"
            href="https://developers.stellar.org"
            target="_blank"
            rel="noreferrer"
          >
            Start building
          </a>
        </div>
      </header>

      {/* ── Full-bleed schematic-blue data panel ────────────────────────── */}
      <section className="pl-datapanel" aria-hidden={false}>
        <div className="pl-streams">
          {columns.map((c, i) => (
            <div key={i} className="pl-stream" style={{ animationDuration: `${c.dur}s` }}>
              {[...c.lines, ...c.lines].map((l, j) => (
                <div key={j}>{l}</div>
              ))}
            </div>
          ))}
        </div>
        <div className="pl-datapanel-center">
          <span className="pl-datapanel-pill">
            {mode === "private"
              ? "What Poof publishes on-chain"
              : "What a transparent ledger leaks"}
          </span>
          <div className="pl-toggle" role="tablist" aria-label="ledger view">
            <button data-active={mode === "private"} onClick={() => setMode("private")}>
              Private
            </button>
            <button data-active={mode === "public"} onClick={() => setMode("public")}>
              Public
            </button>
          </div>
          <span className="pl-datapanel-note">
            {mode === "private"
              ? "commitments · nullifiers · roots — unlinkable"
              : "addresses · amounts · memos — fully exposed"}
          </span>
        </div>
      </section>

      {/* ── Stellar performance stats ───────────────────────────────────── */}
      <section className="pl-container pl-section" id="stellar">
        <div className="pl-eyebrow">Powered by Stellar</div>
        <h2 className="pl-h2">
          A network that settles like <span className="pl-emph-blue">cash</span>, not crypto.
        </h2>
        <p className="pl-body" style={{ marginTop: 16 }}>
          Stellar is an open-source, decentralized blockchain built for payments —
          faster, cheaper, and far more energy-efficient than most chains. Poof inherits
          that base layer and adds privacy on top via Soroban smart contracts.
        </p>
        <div className="pl-stats">
          {[
            ["9.5s", "", "Average settlement time"],
            ["$0.0000", "7667", "Average cost per transaction"],
            ["90", "+", "Countries with cash ramps"],
            ["$203M", "", "Total value locked, and counting"],
          ].map(([num, unit, label], i) => (
            <div className="pl-stat" key={i}>
              <div className="pl-stat-num">
                {num}
                {unit && <span className="pl-unit">{unit}</span>}
              </div>
              <div className="pl-stat-label">{label}</div>
            </div>
          ))}
        </div>
        <p className="pl-body pl-mono" style={{ fontSize: 10, color: "var(--slate)", marginTop: 16, textTransform: "none" }}>
          * Stellar network figures, last 30 days. Source: stellar.org
        </p>
      </section>

      {/* ── How it works (4-col feature row) ────────────────────────────── */}
      <section className="pl-container pl-section" id="how">
        <div className="pl-eyebrow">The flow</div>
        <h2 className="pl-h2">Four moves. The chain never sees a value.</h2>
        <div className="pl-grid-4">
          {FEATURES.map((f, i) => (
            <div className="pl-feature" key={f.t}>
              <div className="pl-feature-index">0{i + 1}</div>
              <h3 className="pl-feature-title">{f.t}</h3>
              <p className="pl-feature-body">{f.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Privacy internals ───────────────────────────────────────────── */}
      <section className="pl-container pl-section" id="private">
        <div className="pl-eyebrow">The load-bearing cryptography</div>
        <h2 className="pl-h2">
          The proof is the <span className="pl-emph-blue">authority</span> — not a decoration.
        </h2>
        <p className="pl-body" style={{ marginTop: 16 }}>
          Poof-grade ZK isn't bolted on for show. At the contract boundary there are no values,
          owners, or notes — only commitments, nullifiers, a root, and a proof. Strip the proof
          and anyone could mint or steal. We keep it load-bearing.
        </p>
        <div className="pl-grid-3">
          {PRIVACY.map((f) => (
            <div className="pl-feature" key={f.t}>
              <h3 className="pl-feature-title">{f.t}</h3>
              <p className="pl-feature-body">{f.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Stellar / Soroban explainer ─────────────────────────────────── */}
      <section className="pl-container pl-section">
        <div className="pl-grid-3" style={{ marginTop: 0 }}>
          <div className="pl-feature">
            <h3 className="pl-feature-title">For builders</h3>
            <p className="pl-feature-body">
              Soroban brings Rust-based, resource-metered smart contracts to Stellar. Poof's
              Groth16 pairing verification fits comfortably inside the network's instruction budget.
            </p>
          </div>
          <div className="pl-feature">
            <h3 className="pl-feature-title">For institutions</h3>
            <p className="pl-feature-body">
              Settlement in seconds for fractions of a cent, with privacy that doesn't sacrifice
              auditability — viewing keys let the right parties see exactly what they should.
            </p>
          </div>
          <div className="pl-feature">
            <h3 className="pl-feature-title">For fintechs &amp; wallets</h3>
            <p className="pl-feature-body">
              Multi-currency, low-cost, 24/7 settlement on a real-world network — extend your
              product with shielded payments without leaving the Stellar ecosystem.
            </p>
          </div>
        </div>
      </section>

      {/* ── Honest disclosure ───────────────────────────────────────────── */}
      <section className="pl-container pl-section" id="honest">
        <div className="pl-eyebrow">No smoke, no mirrors (well — some smoke)</div>
        <h2 className="pl-h2">What's real, what's mocked, what leaks.</h2>
        <div className="pl-grid-3">
          <div>
            <div className="pl-disclosure-title pl-emph-blue">Real &amp; load-bearing</div>
            {[
              "Groth16 verification on-chain",
              "Range checks + value conservation",
              "Nullifier double-spend prevention",
              "Incremental Merkle tree + root history",
              "2-in / 2-out private transfers",
            ].map((x) => (
              <div className="pl-disclosure-item" key={x}>{x}</div>
            ))}
          </div>
          <div>
            <div className="pl-disclosure-title">Mocked / simplified</div>
            {[
              "Single-contributor trusted setup",
              "Viewing-key delegation derived, not exercised",
              "Auto-scan note delivery is staged",
            ].map((x) => (
              <div className="pl-disclosure-item" key={x}>{x}</div>
            ))}
          </div>
          <div>
            <div className="pl-disclosure-title pl-emph-orange">Known leaks</div>
            {[
              "Fee-payer is visible on-chain (relayers are future work)",
              "Small anonymity set on a demo pool",
              "No audit, no ceremony — research-grade",
            ].map((x) => (
              <div className="pl-disclosure-item" key={x}>{x}</div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA band ────────────────────────────────────────────────────── */}
      <section className="pl-cta">
        <div className="pl-container" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 24 }}>
          <div>
            <h2 className="pl-h2" style={{ fontSize: 30 }}>Ready to make value disappear?</h2>
            <p className="pl-body" style={{ marginTop: 8 }}>
              Spin up a shielded identity in seconds. Testnet only — bring play money.
            </p>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Link className="pl-btn pl-btn-orange" to="/app">Launch App →</Link>
            <Link className="pl-btn pl-btn-ghost" to="/app/welcome">Create identity</Link>
          </div>
        </div>
      </section>

      {/* ── Dithered dark footer band ───────────────────────────────────── */}
      <div className="pl-footer-band">
        <div className="pl-footer-band-title">poof — private by construction</div>
        <div className="pl-toggle">
          <button data-active disabled>Shielded</button>
        </div>
      </div>

      {/* ── Footer columns ──────────────────────────────────────────────── */}
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
            <a className="pl-footer-link" href="https://www.stellar.org/foundation" target="_blank" rel="noreferrer">The Foundation</a>
          </div>
          <div>
            <h4 className="pl-footer-head">Connect</h4>
            <a className="pl-footer-link" href="https://github.com" target="_blank" rel="noreferrer">GitHub</a>
            <a className="pl-footer-link" href="https://developers.stellar.org" target="_blank" rel="noreferrer">Developer docs</a>
          </div>
        </div>
        <div className="pl-footer-bottom">
          <span className="pl-status">
            <span className="pl-status-dot" />
            Testnet · All systems operational
          </span>
          <span className="pl-copy">© 2026 Poof · Built on Stellar</span>
        </div>
      </footer>
    </div>
  );
}
