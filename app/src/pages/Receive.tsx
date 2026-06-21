import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useWallet } from "../store/wallet";
import { AddressBadge, Spinner, useToast } from "../components/ui";
import { formatAmount } from "../lib/currencies";

export default function Receive() {
  const { address, notes, scanForNotes, syncing } = useWallet();
  const toast = useToast();
  const [scanning, setScanning] = useState(false);
  if (!address) return null;
  const full = `${address.pubkey}.${address.encPub}`;
  // newest first so freshly-scanned notes surface at the top
  const sortedNotes = [...notes].sort((a, b) => (b.leafIndex ?? 0) - (a.leafIndex ?? 0));

  const scan = async () => {
    setScanning(true);
    try {
      const n = await scanForNotes();
      toast.push(n > 0 ? `Found ${n} incoming note${n > 1 ? "s" : ""}` : "No new notes found", n > 0 ? "ok" : "info");
    } catch (e: any) { toast.push(e.message, "err"); } finally { setScanning(false); }
  };

  return (
    <div className="max-w-md mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-poof-accent/15 grid place-items-center">
          <svg className="h-5 w-5 text-poof-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>
        </div>
        <h1 className="text-2xl font-bold">Receive</h1>
      </div>

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
          <span className="text-xs text-poof-muted">{sortedNotes.length} total</span>
        </div>
        {sortedNotes.length === 0 ? (
          <p className="text-sm text-poof-muted mt-2">No notes yet. Scan after someone sends to you, or deposit to mint your first note.</p>
        ) : (
          <div className="mt-3 divide-y divide-poof-border" data-testid="received-notes">
            {sortedNotes.map((n) => (
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
      </div>
    </div>
  );
}
