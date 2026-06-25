import { NavLink, Link, useNavigate } from "react-router-dom";
import { ReactNode } from "react";
import { useWallet } from "../store/wallet";
import { Logo, AddressBadge, ExplorerLink } from "./ui";
import PoofSparkle from "./PoofSparkle";
import { EXPLORER_ACCOUNT } from "../lib/types";
import { useSchedulePoller } from "../lib/useScheduler";

const NAV = [
  { to: "/app", label: "Dashboard", icon: "M3 12l9-9 9 9M5 10v10h14V10" },
  { to: "/app/deposit", label: "Deposit", icon: "M12 5v14M5 12h14" },
  { to: "/app/send", label: "Send", icon: "M5 12h14M13 6l6 6-6 6" },
  { to: "/app/withdraw", label: "Withdraw", icon: "M12 19V5M5 12l7 7 7-7" },
  { to: "/app/receive", label: "Receive", icon: "M19 12H5M11 18l-6-6 6-6" },
  { to: "/app/scheduled", label: "Scheduled", icon: "M8 2v4M16 2v4M3 10h18M5 6h14a2 2 0 012 2v11a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2" },
  { to: "/app/activity", label: "Activity", icon: "M3 12h4l3 8 4-16 3 8h4" },
  { to: "/app/privacy", label: "Privacy", icon: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" },
  { to: "/app/disclosure", label: "Disclosure", icon: "M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7zM12 9a3 3 0 100 6 3 3 0 000-6" },
];

function Icon({ d }: { d: string }) {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

export default function Layout({ children }: { children: ReactNode }) {
  const { feeAccount, feeBalance, disconnect } = useWallet();
  const nav = useNavigate();
  // single background firing loop for recurring payments (runs app-wide)
  useSchedulePoller();
  return (
    <div className="min-h-full flex">
      <aside className="hidden md:flex w-64 flex-col border-r border-poof-border/50 bg-poof-bg/80 backdrop-blur-xl p-5">
        <Link to="/" className="flex items-center gap-2.5 px-2 mb-8 relative" title="Back to home">
          <div className="relative h-9 w-9 grid place-items-center">
            {/* a faint puff of smoke rising behind the mark */}
            <span className="smoke-wisp h-6 w-6 -top-1 left-1.5 animate-smoke-rise" />
            <Logo className="h-9 w-9 relative animate-float" />
            <PoofSparkle active className="w-9 h-9 -top-0.5 -right-0.5" />
          </div>
          <div>
            <div className="font-bold text-xl leading-none tracking-[-0.5px] text-magic">Poof</div>
            <div className="text-[11px] text-poof-muted">make value disappear</div>
          </div>
        </Link>
        <nav className="flex flex-col gap-1">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === "/app"}
              className={({ isActive }) =>
                `group flex items-center gap-3 rounded-xl px-3 py-2.5 transition relative ${
                  isActive
                    ? "bg-poof-lavender/15 text-poof-lavender shadow-[inset_0_0_0_1px_rgba(167,139,250,0.25)]"
                    : "text-poof-muted hover:text-poof-text hover:bg-poof-card"
                }`
              }>
              {({ isActive }) => (
                <>
                  {isActive && <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-r-full bg-poof-gold" />}
                  <Icon d={n.icon} />
                  <span className="font-medium">{n.label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto space-y-3">
          <div className="card p-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-poof-muted">Fee account</span>
              <span className={`px-1.5 py-0.5 rounded ${feeAccount?.funded ? "bg-poof-success/15 text-poof-success" : "bg-poof-warn/15 text-poof-warn"}`}>
                {feeAccount?.funded ? "funded" : "unfunded"}
              </span>
            </div>
            {feeAccount ? (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <AddressBadge value={feeAccount.publicKey} testid="sidebar-fee-account" />
                <ExplorerLink url={EXPLORER_ACCOUNT + feeAccount.publicKey} testid="sidebar-fee-explorer" />
              </div>
            ) : (
              <div className="mono text-xs mt-1 text-poof-muted">—</div>
            )}
            {feeBalance && <div className="text-xs mt-1">{parseFloat(feeBalance).toFixed(2)} XLM</div>}
          </div>
          <div className="flex items-center justify-between px-1">
            <span className="inline-flex items-center gap-1.5 text-xs text-poof-muted">
              <span className="h-2 w-2 rounded-full bg-poof-gold animate-pulse" /> Testnet
            </span>
            <button onClick={() => { disconnect(); nav("/app/welcome"); }} className="text-xs text-poof-muted hover:text-poof-danger">Disconnect</button>
          </div>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-5 py-8 animate-fade-in">{children}</div>
      </main>
    </div>
  );
}
