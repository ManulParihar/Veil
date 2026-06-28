import { useState } from "react";
import { Filter, Check, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useWallet } from "../store/wallet";
import { StatusChip, truncate, EmptyState, Spinner, useToast } from "../components/ui";
import { EXPLORER_TX, type TxKind } from "../lib/types";
import { formatAmount } from "../lib/currencies";
import PoofLottie from "../components/fx/PoofLottie";

// Type filters for the Activity feed. Each row groups one or more raw tx kinds
// under a friendly label so the checkbox menu stays short.
type TypeFilter = "sent" | "received" | "deposit" | "withdraw" | "funding";
const FILTERS: { id: TypeFilter; label: string; kinds: TxKind[] }[] = [
  { id: "sent", label: "Sent", kinds: ["transfer"] },
  { id: "received", label: "Received", kinds: ["receive"] },
  { id: "deposit", label: "Deposit", kinds: ["deposit"] },
  { id: "withdraw", label: "Withdraw", kinds: ["withdraw"] },
  { id: "funding", label: "Funding", kinds: ["faucet", "fund"] },
];
// kind → filter id, so a tx can be matched against the selected set in O(1).
const KIND_TO_FILTER = new Map<TxKind, TypeFilter>(
  FILTERS.flatMap((f) => f.kinds.map((k) => [k, f.id] as [TxKind, TypeFilter])),
);
const PAGE_SIZE = 10;

export default function Activity() {
  const { txs, scanForNotes, syncing } = useWallet();
  const toast = useToast();
  const [scanning, setScanning] = useState(false);

  // Type filter (multi-select) + pagination. Default is no boxes checked, which
  // behaves identically to every box checked: nothing is filtered out.
  const [selected, setSelected] = useState<Set<TypeFilter>>(() => new Set());
  const [menuOpen, setMenuOpen] = useState(false);
  const [page, setPage] = useState(0);

  const scan = async () => {
    setScanning(true);
    try {
      const n = await scanForNotes();
      toast.push(n > 0 ? `Found ${n} incoming note${n > 1 ? "s" : ""}` : "No new notes found", n > 0 ? "ok" : "info");
    } catch (e: any) { toast.push(e.message, "err"); } finally { setScanning(false); }
  };

  // Empty selection (or a full one) means "show everything"; only a partial
  // selection narrows the feed.
  const narrowed = selected.size > 0 && selected.size < FILTERS.length;
  const filtered = narrowed
    ? txs.filter((t) => {
        const f = KIND_TO_FILTER.get(t.kind);
        return f ? selected.has(f) : true;
      })
    : txs;
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1); // clamp without mutating during render
  const visible = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const toggleFilter = (id: TypeFilter) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setPage(0);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-poof-lavender/15 grid place-items-center">
          <svg className="h-5 w-5 text-poof-lavender" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h4l3 8 4-16 3 8h4"/></svg>
        </div>
        <h1 className="text-2xl font-bold">Activity</h1>
      </div>
      {txs.length === 0 ? (
        <EmptyState
          title="No activity yet"
          sub="Your transactions will appear here."
          icon={<PoofLottie name="bored" className="h-28 w-28 mx-auto" />}
        />
      ) : (
        <>
          {/* count + type filter */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-poof-muted">
              {narrowed ? `${filtered.length} of ${txs.length}` : `${filtered.length} total`}
            </span>
            <div className="flex items-center gap-2">
              <button
                title="Scan for incoming payments"
                data-testid="activity-scan-btn"
                onClick={scan}
                disabled={scanning || syncing}
                className="h-8 w-8 grid place-items-center rounded-lg border border-poof-border text-poof-muted hover:text-poof-text hover:border-poof-lavender transition disabled:opacity-50"
              >
                {scanning || syncing ? <Spinner className="h-3.5 w-3.5" /> : <Search className="h-3.5 w-3.5" />}
              </button>
              <div className="relative">
              <button
                title="Filter by type"
                data-testid="activity-filter-btn"
                onClick={() => setMenuOpen((o) => !o)}
                className={`h-8 w-8 grid place-items-center rounded-lg border transition ${
                  menuOpen || narrowed
                    ? "border-poof-lavender text-poof-lavender"
                    : "border-poof-border text-poof-muted hover:text-poof-text hover:border-poof-lavender"
                }`}
              >
                <Filter className="h-3.5 w-3.5" />
                {narrowed && <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-poof-lavender" />}
              </button>

              {menuOpen && (
                <>
                  {/* click-away backdrop */}
                  <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                  <div
                    data-testid="activity-filter-menu"
                    className="absolute right-0 mt-2 z-20 w-44 rounded-xl border border-poof-border bg-poof-surface p-1.5 shadow-lg"
                  >
                    <div className="flex items-center justify-between px-2 py-1">
                      <span className="text-[11px] uppercase tracking-wide text-poof-muted">Type</span>
                      <button
                        data-testid="activity-filter-clear"
                        onClick={() => { setSelected(new Set()); setPage(0); }}
                        disabled={selected.size === 0}
                        className="text-[11px] text-poof-gold hover:underline disabled:opacity-40 disabled:no-underline"
                      >
                        Clear
                      </button>
                    </div>
                    {FILTERS.map((f) => {
                      const on = selected.has(f.id);
                      return (
                        <button
                          key={f.id}
                          data-testid={`activity-filter-${f.id}`}
                          onClick={() => toggleFilter(f.id)}
                          className="w-full flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-left hover:bg-poof-border/40 transition"
                        >
                          <span className={`h-4 w-4 grid place-items-center rounded border ${on ? "bg-poof-lavender border-poof-lavender" : "border-poof-border"}`}>
                            {on && <Check className="h-3 w-3 text-poof-bg" />}
                          </span>
                          <span className={on ? "text-poof-text" : "text-poof-muted"}>{f.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
              </div>
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="card px-5 py-8 text-center text-sm text-poof-muted">No matching activity.</div>
          ) : (
            <div className="card divide-y divide-poof-border" data-testid="activity-list">
              {visible.map((t) => (
                <div key={t.id} className="px-5 py-4 flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full shrink-0 ${t.kind === "deposit" ? "bg-poof-success" : t.kind === "withdraw" ? "bg-poof-gold" : t.kind === "transfer" ? "bg-poof-lavender" : "bg-poof-accent"}`} />
                      <span className="capitalize font-medium">{t.kind}</span>
                      <StatusChip status={t.status} />
                    </div>
                    <div className="text-xs text-poof-muted mt-0.5">{new Date(t.createdAt).toLocaleString()}</div>
                    {t.error && <div className="text-xs text-poof-danger mt-1 max-w-md break-words">{t.error}</div>}
                  </div>
                  <div className="text-right">
                    <div className="tabular-nums font-medium">{formatAmount(t.amount, t.currencyId)}</div>
                    {t.hash && (
                      <a href={EXPLORER_TX + t.hash} target="_blank" rel="noreferrer" className="text-xs text-poof-gold hover:underline">
                        {truncate(t.hash, 6, 4)} ↗
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {filtered.length > PAGE_SIZE && (
            <div className="flex items-center justify-between">
              <button
                title="Previous page"
                data-testid="activity-prev"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={safePage === 0}
                className="h-8 w-8 grid place-items-center rounded-lg border border-poof-border text-poof-muted hover:text-poof-text hover:border-poof-lavender transition disabled:opacity-50"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <span className="text-xs text-poof-muted tabular-nums">Page {safePage + 1} of {pageCount}</span>
              <button
                title="Next page"
                data-testid="activity-next"
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                disabled={safePage >= pageCount - 1}
                className="h-8 w-8 grid place-items-center rounded-lg border border-poof-border text-poof-muted hover:text-poof-text hover:border-poof-lavender transition disabled:opacity-50"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
