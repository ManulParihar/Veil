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
      <div>
        <h1 className="text-2xl font-bold">Receive</h1>
        <p className="text-veil-muted text-sm">Share your Veil address. Senders encrypt notes to it; you discover them by scanning.</p>
      </div>

      <div className="card p-6 flex flex-col items-center">
        <div className="bg-white rounded-2xl p-4">
          <QRCodeSVG value={full} size={184} bgColor="#ffffff" fgColor="#0a0a12" level="M" />
        </div>
        <div className="mt-4 w-full space-y-2">
          <div className="label">Your address</div>
          <div data-testid="receive-address" className="mono text-xs break-all bg-veil-surface rounded-xl p-3 border border-veil-border">{full}</div>
          <AddressBadge value={full} label="copy address" testid="copy-address" />
        </div>
      </div>

      <div className="card p-6">
        <div className="font-medium">Discover incoming notes</div>
        <p className="text-sm text-veil-muted mt-1">Trial-decrypt on-chain commitments with your viewing key (1-byte view-tag fast path).</p>
        <button data-testid="scan-btn" onClick={scan} disabled={scanning || syncing} className="btn-primary w-full mt-4">
          {scanning || syncing ? <><Spinner /> Scanning…</> : "Scan for notes"}
        </button>
      </div>

      <div className="card p-6">
        <div className="flex items-center justify-between">
          <div className="font-medium">Your notes</div>
          <span className="text-xs text-veil-muted">{sortedNotes.length} total</span>
        </div>
        {sortedNotes.length === 0 ? (
          <p className="text-sm text-veil-muted mt-2">No notes yet. Scan after someone sends to you, or deposit to mint your first note.</p>
        ) : (
          <div className="mt-3 divide-y divide-veil-border" data-testid="received-notes">
            {sortedNotes.map((n) => (
              <div key={n.leafIndex ?? `${n.createdAt}`} className="flex items-center justify-between py-2.5">
                <div className="flex items-center gap-2">
                  <span className="tabular-nums font-medium">{formatAmount(n.note.amount, n.note.currencyId)}</span>
                  {n.leafIndex != null && <span className="text-xs text-veil-muted">leaf #{n.leafIndex}</span>}
                </div>
                <span className={`text-xs rounded-full px-2.5 py-0.5 ${n.spent ? "bg-veil-border text-veil-muted" : "bg-veil-success/15 text-veil-success"}`}>
                  {n.spent ? "spent" : "unspent"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
