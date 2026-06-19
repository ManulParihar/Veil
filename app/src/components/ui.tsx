// Shared UI primitives for the Veil wallet.
import { useState, useCallback, createContext, useContext, ReactNode } from "react";

export function Logo({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none">
      <defs>
        <linearGradient id="vg" x1="0" y1="0" x2="32" y2="32">
          <stop stopColor="#7c5cff" />
          <stop offset="1" stopColor="#22d3ee" />
        </linearGradient>
      </defs>
      <path d="M16 2 4 8v8c0 7 5 12 12 14 7-2 12-7 12-14V8L16 2Z" stroke="url(#vg)" strokeWidth="2" fill="rgba(124,92,255,0.12)" />
      <path d="M11 14l5 6 5-6" stroke="url(#vg)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Spinner({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-20" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`card p-6 ${className}`}>{children}</div>;
}

export function StatCard({ label, value, sub, accent }: { label: string; value: ReactNode; sub?: ReactNode; accent?: boolean }) {
  return (
    <div className={`card p-5 ${accent ? "shadow-glow border-veil-primary/40" : ""}`}>
      <div className="text-sm text-veil-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="mt-1 text-xs text-veil-muted">{sub}</div>}
    </div>
  );
}

export function truncate(s: string, head = 8, tail = 6) {
  if (!s) return "";
  return s.length <= head + tail + 1 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`;
}

export function AddressBadge({ value, label, testid }: { value: string; label?: string; testid?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  return (
    <button onClick={copy} data-testid={testid} title="Copy"
      className="group inline-flex items-center gap-2 rounded-lg bg-veil-surface border border-veil-border px-3 py-1.5 mono hover:border-veil-primary transition">
      {label && <span className="text-veil-muted not-italic">{label}</span>}
      <span className="text-veil-text">{truncate(value)}</span>
      <span className={`text-xs ${copied ? "text-veil-success" : "text-veil-muted group-hover:text-veil-primary"}`}>
        {copied ? "copied" : "copy"}
      </span>
    </button>
  );
}

export function AmountInput({ value, onChange, max, testid }: { value: string; onChange: (v: string) => void; max?: bigint; testid?: string }) {
  return (
    <div>
      <div className="relative">
        <input
          data-testid={testid}
          inputMode="numeric"
          className="input pr-20 text-lg"
          placeholder="0"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ""))}
        />
        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-veil-muted font-medium">VEIL</span>
      </div>
      {max !== undefined && (
        <button onClick={() => onChange(max.toString())} className="mt-1.5 text-xs text-veil-primary hover:underline">
          Max: {max.toString()} VEIL
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, sub, icon }: { title: string; sub?: string; icon?: ReactNode }) {
  return (
    <div className="card p-10 text-center">
      <div className="mx-auto mb-3 text-veil-muted">{icon}</div>
      <div className="font-medium">{title}</div>
      {sub && <div className="text-sm text-veil-muted mt-1">{sub}</div>}
    </div>
  );
}

// ── toast ──
interface Toast { id: number; msg: string; kind: "ok" | "err" | "info"; }
const ToastCtx = createContext<{ push: (msg: string, kind?: Toast["kind"]) => void }>({ push: () => {} });
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((msg: string, kind: Toast["kind"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);
  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} data-testid="toast"
            className={`animate-fade-in card px-4 py-3 text-sm shadow-glow border-l-4 ${
              t.kind === "ok" ? "border-l-veil-success" : t.kind === "err" ? "border-l-veil-danger" : "border-l-veil-primary"
            }`}>
            {t.msg}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function StatusChip({ status }: { status: string }) {
  const map: Record<string, string> = {
    success: "bg-veil-success/15 text-veil-success",
    error: "bg-veil-danger/15 text-veil-danger",
    building: "bg-veil-warn/15 text-veil-warn",
    proving: "bg-veil-primary/15 text-veil-primary",
    submitting: "bg-veil-accent/15 text-veil-accent",
  };
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${map[status] ?? "bg-veil-border text-veil-muted"}`}>{status}</span>;
}
