import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useWallet } from "../store/wallet";
import { AddressBadge, AmountInput, Spinner, useToast } from "../components/ui";
import CurrencySelect from "../components/CurrencySelect";
import { currencyById, formatAmount, DEFAULT_CURRENCY_ID } from "../lib/currencies";
import { encodePaymentLink } from "../lib/paymentLink";

type Tab = "address" | "request";
type NoteFilter = "all" | "unspent" | "spent" | "invalid";

const PAGE_SIZE = 10;

export default function Receive() {
  const { address, notes, scanForNotes, syncing } = useWallet();
  const toast = useToast();
  const [scanning, setScanning] = useState(false);
  const [tab, setTab] = useState<Tab>("address");

  // "Your notes" filter + pagination
  const [noteFilter, setNoteFilter] = useState<NoteFilter>("all");
  const [page, setPage] = useState(0);

  // request-builder state
  const [amount, setAmount] = useState("");
  const [currencyId, setCurrencyId] = useState(DEFAULT_CURRENCY_ID);
  const [label, setLabel] = useState("");
  const [memo, setMemo] = useState("");

  if (!address) return null;
  const full = `${address.pubkey}.${address.encPub}`;
  // newest first so freshly-scanned notes surface at the top
  const sortedNotes = [...notes].sort((a, b) => (b.leafIndex ?? 0) - (a.leafIndex ?? 0));

  // Filter + paginate the notes list. The classifier mirrors the badge logic below
  // so a tab and a note's badge can never disagree.
  const filtered = sortedNotes.filter((n) => {
    if (noteFilter === "all") return true;
    if (noteFilter === "invalid") return !!n.invalidReason;
    if (noteFilter === "spent") return !n.invalidReason && n.spent;
    return !n.invalidReason && !n.spent; // unspent
  });
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1); // clamp without mutating during render
  const visible = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const requestLink = useMemo(() => {
    try {
      return encodePaymentLink({
        pubkey: address.pubkey,
        encPub: address.encPub,
        amount: amount || undefined,
        currencyId,
        label: label || undefined,
        memo: memo || undefined,
      });
    } catch {
      return full;
    }
  }, [address, amount, currencyId, label, memo, full]);

  const scan = async () => {
    setScanning(true);
    try {
      const n = await scanForNotes();
      toast.push(n > 0 ? `Found ${n} incoming note${n > 1 ? "s" : ""}` : "No new notes found", n > 0 ? "ok" : "info");
    } catch (e: any) { toast.push(e.message, "err"); } finally { setScanning(false); }
  };

  const sym = currencyById(currencyId).symbol;

  return (
    <div className="max-w-md mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-poof-accent/15 grid place-items-center">
          <svg className="h-5 w-5 text-poof-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>
        </div>
        <h1 className="text-2xl font-bold">Receive</h1>
      </div>

      {/* tab switch */}
      <div className="flex gap-1 rounded-xl bg-poof-surface border border-poof-border p-1">
        {([["address", "My address"], ["request", "Request payment"]] as [Tab, string][]).map(([id, lbl]) => (
          <button
            key={id}
            data-testid={`receive-tab-${id}`}
            onClick={() => setTab(id)}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${
              tab === id ? "bg-poof-lavender/15 text-poof-lavender shadow-[inset_0_0_0_1px_rgba(167,139,250,0.25)]" : "text-poof-muted hover:text-poof-text"
            }`}
          >
            {lbl}
          </button>
        ))}
      </div>

      {tab === "address" ? (
        <div className="card card-glow p-6 flex flex-col items-center">
          <div className="bg-white rounded-2xl p-4">
            <QRCodeSVG value={full} size={184} bgColor="#ffffff" fgColor="#0a0a12" level="M" />
          </div>
          <div className="mt-4 w-full space-y-2">
            <div className="label">Your address</div>
            <div data-testid="receive-address" className="mono text-xs break-all bg-poof-surface rounded-xl p-3 border border-poof-border">{full}</div>
            <AddressBadge value={full} label="copy address" testid="copy-address" />
          </div>
        </div>
      ) : (
        <div className="card card-glow p-6 space-y-4">
          <p className="text-sm text-poof-muted -mt-1">
            Share a request and the payer's wallet prefills the amount automatically. The link reveals
            nothing spendable — only where to send.
          </p>
          <div>
            <div className="label">Asset</div>
            <CurrencySelect value={currencyId} onChange={setCurrencyId} testid="request-currency" />
          </div>
          <div>
            <div className="label">Amount <span className="text-poof-muted font-normal">(optional)</span></div>
            <AmountInput value={amount} onChange={setAmount} unit={sym} testid="request-amount" />
          </div>
          <div>
            <div className="label">Label <span className="text-poof-muted font-normal">(optional, public)</span></div>
            <input
              data-testid="request-label"
              className="input text-sm"
              placeholder="e.g. Invoice #42 / Coffee"
              maxLength={120}
              value={label}
              onChange={(e) => setLabel(e.target.value.slice(0, 120))}
            />
          </div>

          <div className="rounded-xl bg-white p-4 flex justify-center">
            <QRCodeSVG data-testid="request-qr" value={requestLink} size={184} bgColor="#ffffff" fgColor="#0a0a12" level="M" />
          </div>

          <div className="space-y-2">
            <div className="label">Payment link</div>
            <div data-testid="request-link" className="mono text-[11px] break-all bg-poof-surface rounded-xl p-3 border border-poof-border">{requestLink}</div>
            <div className="flex flex-wrap gap-2">
              <AddressBadge value={requestLink} label="copy link" testid="copy-request-link" />
              {amount && (
                <span className="inline-flex items-center rounded-lg bg-poof-gold/10 border border-poof-gold/30 px-3 py-1.5 text-xs text-poof-gold">
                  Requesting {amount} {sym}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="card p-6">
        <div className="flex items-center gap-2 font-medium">
          <svg className="h-4 w-4 text-poof-lavender" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
          Scan for notes
        </div>
        <button data-testid="scan-btn" onClick={scan} disabled={scanning || syncing} className="btn-primary w-full mt-3">
          {scanning || syncing ? <><Spinner /> Scanning…</> : "Scan for notes"}
        </button>
      </div>

      <div className="card p-6">
        <div className="flex items-center justify-between">
          <div className="font-medium">Your notes</div>
          <span className="text-xs text-poof-muted">{filtered.length} {noteFilter === "all" ? "total" : noteFilter}</span>
        </div>

        {/* filter tabs */}
        <div className="mt-3 flex gap-1 rounded-xl bg-poof-surface border border-poof-border p-1">
          {([["all", "All"], ["unspent", "Unspent"], ["spent", "Spent"], ["invalid", "Invalid"]] as [NoteFilter, string][]).map(([id, lbl]) => (
            <button
              key={id}
              data-testid={`notes-filter-${id}`}
              onClick={() => { setNoteFilter(id); setPage(0); }}
              className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-medium transition ${
                noteFilter === id ? "bg-poof-lavender/15 text-poof-lavender shadow-[inset_0_0_0_1px_rgba(167,139,250,0.25)]" : "text-poof-muted hover:text-poof-text"
              }`}
            >
              {lbl}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <p className="text-sm text-poof-muted mt-3">
            {noteFilter === "all"
              ? "No notes yet. Scan after someone sends to you, or deposit to mint your first note."
              : `No ${noteFilter} notes.`}
          </p>
        ) : (
          <div className="mt-3 divide-y divide-poof-border" data-testid="received-notes">
            {visible.map((n) => (
              <div key={n.leafIndex ?? `${n.createdAt}`} className={`py-2.5 ${(n as any).memo ? "border-l-2 border-l-poof-lavender/40 pl-3" : ""}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="tabular-nums font-medium">{formatAmount(n.note.amount, n.note.currencyId)}</span>
                    {(n as any).memo && (
                      <svg className="h-3.5 w-3.5 text-poof-lavender" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
                      </svg>
                    )}
                    {n.leafIndex != null && <span className="text-xs text-poof-muted">leaf #{n.leafIndex}</span>}
                  </div>
                <span
                  title={n.invalidReason}
                  className={`text-xs rounded-full px-2.5 py-0.5 ${
                    n.invalidReason
                      ? "bg-poof-danger/15 text-poof-danger"
                      : n.spent
                        ? "bg-poof-border text-poof-muted"
                        : "bg-poof-success/15 text-poof-success"
                  }`}
                >
                  {n.invalidReason ? "invalid" : n.spent ? "spent" : "unspent"}
                </span>
                </div>
                {(n as any).memo && (
                  <div className="text-sm text-poof-muted italic mt-1">{(n as any).memo}</div>
                )}
              </div>
            ))}
          </div>
        )}

        {filtered.length > PAGE_SIZE && (
          <div className="mt-4 flex items-center justify-between">
            <button
              title="Previous page"
              data-testid="notes-prev"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={safePage === 0}
              className="h-8 w-8 grid place-items-center rounded-lg border border-poof-border text-poof-muted hover:text-poof-text hover:border-poof-lavender transition disabled:opacity-50"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="text-xs text-poof-muted tabular-nums">Page {safePage + 1} of {pageCount}</span>
            <button
              title="Next page"
              data-testid="notes-next"
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              disabled={safePage >= pageCount - 1}
              className="h-8 w-8 grid place-items-center rounded-lg border border-poof-border text-poof-muted hover:text-poof-text hover:border-poof-lavender transition disabled:opacity-50"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
