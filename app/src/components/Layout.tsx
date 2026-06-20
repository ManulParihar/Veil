import { NavLink, useNavigate } from "react-router-dom";
import { ReactNode } from "react";
import { useWallet } from "../store/wallet";
import { Logo, AddressBadge, ExplorerLink } from "./ui";
import { EXPLORER_ACCOUNT } from "../lib/types";

const NAV = [
  { to: "/", label: "Dashboard", icon: "M3 12l9-9 9 9M5 10v10h14V10" },
  { to: "/deposit", label: "Deposit", icon: "M12 5v14M5 12h14" },
  { to: "/send", label: "Send", icon: "M5 12h14M13 6l6 6-6 6" },
  { to: "/withdraw", label: "Withdraw", icon: "M12 19V5M5 12l7 7 7-7" },
  { to: "/receive", label: "Receive", icon: "M19 12H5M11 18l-6-6 6-6" },
  { to: "/activity", label: "Activity", icon: "M3 12h4l3 8 4-16 3 8h4" },
];

function Icon({ d }: { d: string }) {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

export default function Layout({ children }: { children: ReactNode }) {
  const { feeAccount, feeBalance, reset } = useWallet();
  const nav = useNavigate();
  return (
    <div className="min-h-full flex">
      <aside className="hidden md:flex w-64 flex-col border-r border-veil-border bg-veil-surface/60 backdrop-blur p-5">
        <div className="flex items-center gap-2.5 px-2 mb-8">
          <Logo />
          <div>
            <div className="font-bold text-lg leading-none">Veil</div>
            <div className="text-[11px] text-veil-muted">private payments</div>
          </div>
        </div>
        <nav className="flex flex-col gap-1">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === "/"}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-3 py-2.5 transition ${
                  isActive ? "bg-veil-primary/15 text-veil-primary" : "text-veil-muted hover:text-veil-text hover:bg-veil-card"
                }`
              }>
              <Icon d={n.icon} />
              <span className="font-medium">{n.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto space-y-3">
          <div className="card p-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-veil-muted">Fee account</span>
              <span className={`px-1.5 py-0.5 rounded ${feeAccount?.funded ? "bg-veil-success/15 text-veil-success" : "bg-veil-warn/15 text-veil-warn"}`}>
                {feeAccount?.funded ? "funded" : "unfunded"}
              </span>
            </div>
            {feeAccount ? (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <AddressBadge value={feeAccount.publicKey} testid="sidebar-fee-account" />
                <ExplorerLink url={EXPLORER_ACCOUNT + feeAccount.publicKey} testid="sidebar-fee-explorer" />
              </div>
            ) : (
              <div className="mono text-xs mt-1 text-veil-muted">—</div>
            )}
            {feeBalance && <div className="text-xs mt-1">{parseFloat(feeBalance).toFixed(2)} XLM</div>}
          </div>
          <div className="flex items-center justify-between px-1">
            <span className="inline-flex items-center gap-1.5 text-xs text-veil-muted">
              <span className="h-2 w-2 rounded-full bg-veil-accent animate-pulse" /> Testnet
            </span>
            <button onClick={() => { reset(); nav("/welcome"); }} className="text-xs text-veil-muted hover:text-veil-danger">reset</button>
          </div>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-5 py-8 animate-fade-in">{children}</div>
      </main>
    </div>
  );
}
