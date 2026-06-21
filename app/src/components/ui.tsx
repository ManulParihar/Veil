// Shared UI primitives for the Poof wallet — gold + lavender magic.
import { useState, useCallback, createContext, useContext, ReactNode } from "react";

/**
 * Poof mark — a smoke puff curling up off a base line, where a coin used to be.
 * Gold rim, lavender body, with sparkle dots that twinkle. Value, vanishing.
 */
export function Logo({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" aria-hidden>
      <defs>
        <linearGradient id="pg-rim" x1="6" y1="6" x2="26" y2="28" gradientUnits="userSpaceOnUse">
          <stop stopColor="#E8D5A3" />
          <stop offset="0.55" stopColor="#A78BFA" />
          <stop offset="1" stopColor="#E85A9E" />
        </linearGradient>
        <radialGradient id="pg-body" cx="0.5" cy="0.42" r="0.65">
          <stop stopColor="#A78BFA" stopOpacity="0.45" />
          <stop offset="1" stopColor="#A78BFA" stopOpacity="0.08" />
        </radialGradient>
      </defs>
      {/* the smoke puff */}
      <path
        d="M9.5 20.5c-2.8 0-4.5-1.9-4.2-4.3.2-1.9 1.8-3.2 3.6-3.2.2-2.6 2.3-4.7 5-4.7 1.9 0 3.6 1 4.5 2.6.6-.4 1.4-.6 2.2-.6 2.3 0 4.1 1.8 4.1 4.1 0 .3 0 .6-.1.9 1.5.4 2.6 1.8 2.6 3.4 0 1.9-1.6 3.5-3.6 3.5H9.5Z"
        fill="url(#pg-body)"
        stroke="url(#pg-rim)"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      {/* rising wisp */}
      <path
        d="M15 9.5c1-1.1.6-2.4-.3-3.1-.9-.7-1.1-1.6-.4-2.6"
        stroke="url(#pg-rim)"
        strokeWidth="1.6"
        strokeLinecap="round"
        fill="none"
      />
      {/* base line the puff lifted off */}
      <path d="M9 24.5h14" stroke="#3F3852" strokeWidth="1.8" strokeLinecap="round" />
      {/* sparkles */}
      <circle cx="24.5" cy="8.5" r="1.5" fill="#E8D5A3" className="animate-sparkle" />
      <circle cx="6.5" cy="10.5" r="1" fill="#E85A9E" className="animate-sparkle" style={{ animationDelay: "0.4s" }} />
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
    <div className={`card p-5 ${accent ? "shadow-glow border-poof-gold/40" : ""}`}>
      <div className="text-sm text-poof-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="mt-1 text-xs text-poof-muted">{sub}</div>}
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
      className="group inline-flex items-center gap-2 rounded-lg bg-poof-surface border border-poof-border px-3 py-1.5 mono hover:border-poof-gold transition poof-glow">
      {label && <span className="text-poof-muted not-italic">{label}</span>}
      <span className="text-poof-text">{truncate(value)}</span>
      <span className={`text-xs ${copied ? "text-poof-success" : "text-poof-muted group-hover:text-poof-gold"}`}>
        {copied ? "copied" : "copy"}
      </span>
    </button>
  );
}

/** A small external-link button to a block explorer (or any URL). */
export function ExplorerLink({ url, label = "explorer", testid }: { url: string; label?: string; testid?: string }) {
  return (
    <a href={url} target="_blank" rel="noreferrer" data-testid={testid} title="View on Stellar Expert"
      className="inline-flex items-center gap-1 rounded-lg border border-poof-border px-2.5 py-1.5 text-xs text-poof-gold hover:border-poof-gold transition">
      {label} ↗
    </a>
  );
}

/**
 * A secret value (e.g. the recovery seed) masked by default, with a reveal
 * toggle and a copy button. Copy always copies the real value, even while masked.
 */
export function SecretReveal({ value, testid }: { value: string; testid?: string }) {
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  const masked = "•".repeat(Math.min(value.length, 64));
  return (
    <div className="space-y-2">
      <div
        data-testid={testid}
        data-revealed={shown}
        className="mono text-sm break-all bg-poof-surface rounded-xl p-3 border border-poof-border select-all"
      >
        {shown ? value : masked}
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => setShown((v) => !v)}
          data-testid={testid ? `${testid}-reveal` : undefined}
          className="rounded-lg border border-poof-border px-3 py-1.5 text-xs text-poof-muted hover:border-poof-gold hover:text-poof-text transition"
        >
          {shown ? "Hide" : "Reveal"}
        </button>
        <button
          onClick={copy}
          data-testid={testid ? `${testid}-copy` : undefined}
          className={`rounded-lg border border-poof-border px-3 py-1.5 text-xs transition hover:border-poof-gold ${copied ? "text-poof-success" : "text-poof-muted hover:text-poof-text"}`}
        >
          {copied ? "copied" : "copy"}
        </button>
      </div>
    </div>
  );
}

export function AmountInput({ value, onChange, max, unit = "XLM", testid }: { value: string; onChange: (v: string) => void; max?: string; unit?: string; testid?: string }) {
  const sanitize = (v: string) => {
    const cleaned = v.replace(/[^0-9.]/g, "");
    const i = cleaned.indexOf(".");
    return i === -1 ? cleaned : cleaned.slice(0, i + 1) + cleaned.slice(i + 1).replace(/\./g, "");
  };
  return (
    <div>
      <div className="relative">
        <input
          data-testid={testid}
          inputMode="decimal"
          className="input pr-20 text-lg"
          placeholder="0.0"
          value={value}
          onChange={(e) => onChange(sanitize(e.target.value))}
        />
        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-poof-muted font-medium">{unit}</span>
      </div>
      {max !== undefined && (
        <button onClick={() => onChange(max)} className="mt-1.5 text-xs text-poof-gold hover:underline">
          Max: {max} {unit}
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, sub, icon }: { title: string; sub?: string; icon?: ReactNode }) {
  return (
    <div className="card p-10 text-center">
      <div className="mx-auto mb-3 text-poof-muted">{icon}</div>
      <div className="font-medium">{title}</div>
      {sub && <div className="text-sm text-poof-muted mt-1">{sub}</div>}
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
              t.kind === "ok" ? "border-l-poof-success" : t.kind === "err" ? "border-l-poof-danger" : "border-l-poof-gold"
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
    success: "bg-poof-success/15 text-poof-success",
    error: "bg-poof-danger/15 text-poof-danger",
    building: "bg-poof-warn/15 text-poof-warn",
    proving: "bg-poof-lavender/15 text-poof-lavender",
    submitting: "bg-poof-gold/15 text-poof-gold",
  };
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${map[status] ?? "bg-poof-border text-poof-muted"}`}>{status}</span>;
}
