import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useWallet } from "../store/wallet";
import { AddressBadge, SecretReveal, Spinner, useToast } from "../components/ui";
import { deriveKeys, fromHex } from "../lib/crypto";
import { getNewCommitments } from "../lib/chain";
import { formatAmount } from "../lib/currencies";
import { CONTRACT_ID } from "../lib/types";
import {
  exportViewingKey, serializeViewingKey, parseViewingKey, auditWithViewingKey, type AuditedNote,
  makeReceiptFromStored, serializeReceipt, parseReceipt, verifyReceipt, verifyReceiptOnChain,
  type PaymentReceipt, type ReceiptVerification,
} from "../lib/disclosure";

type Section = "viewingkey" | "audit" | "receipts";

export default function Disclosure() {
  const { seedHex, notes } = useWallet();
  const toast = useToast();
  const [section, setSection] = useState<Section>("viewingkey");

  const viewingKeyToken = useMemo(() => {
    if (!seedHex) return "";
    try { return serializeViewingKey(exportViewingKey(deriveKeys(fromHex(seedHex)), CONTRACT_ID)); }
    catch { return ""; }
  }, [seedHex]);

  // ── audit tool ──
  const [vkInput, setVkInput] = useState("");
  const [auditing, setAuditing] = useState(false);
  const [audited, setAudited] = useState<AuditedNote[] | null>(null);
  const runAudit = async () => {
    const vk = parseViewingKey(vkInput.trim() || viewingKeyToken);
    if (!vk) { toast.push("Not a valid viewing key", "err"); return; }
    setAuditing(true);
    setAudited(null);
    try {
      const events = await getNewCommitments();
      setAudited(auditWithViewingKey(vk, events));
    } catch (e: any) {
      toast.push(e?.message ?? "audit failed", "err");
    } finally { setAuditing(false); }
  };
  const auditTotal = useMemo(
    () => (audited ?? []).reduce((s, a) => s + a.note.amount, 0n),
    [audited]
  );

  // ── receipts ──
  const ownNotes = useMemo(() => notes.filter((n) => n.leafIndex != null), [notes]);
  const [generated, setGenerated] = useState<PaymentReceipt | null>(null);
  const generate = (idx: number) => {
    const n = ownNotes[idx];
    if (!n) return;
    setGenerated(makeReceiptFromStored(n, CONTRACT_ID));
  };

  // paginate the receipts list — 10 notes per page
  const RECEIPTS_PAGE_SIZE = 10;
  const [rcptPage, setRcptPage] = useState(0);
  const rcptPageCount = Math.max(1, Math.ceil(ownNotes.length / RECEIPTS_PAGE_SIZE));
  const safeRcptPage = Math.min(rcptPage, rcptPageCount - 1); // clamp without mutating during render
  const visibleNotes = ownNotes.slice(safeRcptPage * RECEIPTS_PAGE_SIZE, safeRcptPage * RECEIPTS_PAGE_SIZE + RECEIPTS_PAGE_SIZE);

  const [rcptInput, setRcptInput] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{ r: PaymentReceipt; v: ReceiptVerification } | null>(null);
  const verify = async () => {
    const r = parseReceipt(rcptInput.trim());
    if (!r) { toast.push("Not a valid receipt", "err"); return; }
    setVerifying(true);
    setVerifyResult(null);
    try {
      // self-check first (offline, instant), then confirm on-chain presence
      let v = verifyReceipt(r);
      try {
        const events = await getNewCommitments();
        v = verifyReceiptOnChain(r, events);
      } catch { /* on-chain check best-effort; self-check still stands */ }
      setVerifyResult({ r, v });
    } finally { setVerifying(false); }
  };

  if (!seedHex) return null;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-poof-gold/15 grid place-items-center">
          <svg className="h-5 w-5 text-poof-gold" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>
        </div>
        <div>
          <h1 className="text-2xl font-bold">Selective disclosure</h1>
          <p className="text-sm text-poof-muted">Privacy that opts into auditability — never into spending.</p>
        </div>
      </div>

      {/* section switch */}
      <div className="flex gap-1 rounded-xl bg-poof-surface border border-poof-border p-1">
        {([["viewingkey", "Viewing key"], ["audit", "Audit"], ["receipts", "Receipts"]] as [Section, string][]).map(([id, lbl]) => (
          <button key={id} data-testid={`disclosure-tab-${id}`} onClick={() => setSection(id)}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${
              section === id ? "bg-poof-gold/15 text-poof-gold shadow-[inset_0_0_0_1px_rgba(232,213,163,0.25)]" : "text-poof-muted hover:text-poof-text"
            }`}>
            {lbl}
          </button>
        ))}
      </div>

      {section === "viewingkey" && (
        <div className="card card-glow p-6 space-y-4">
          <p className="text-sm text-poof-muted">
            Hand this to an accountant or auditor and they can see every payment you've
            <span className="text-poof-text"> received</span> — amounts, assets, timing — by replaying the
            pool. They <span className="text-poof-text">cannot spend</span>: a viewing key carries the
            encryption secret, never the spend key.
          </p>
          <div className="rounded-xl border border-poof-warn/40 bg-poof-warn/10 p-3 text-xs text-poof-warn">
            ⚠ Sharing a viewing key permanently reveals your full receiving history to its holder. There is no revocation.
          </div>
          <div>
            <div className="label">Your viewing key</div>
            <SecretReveal value={viewingKeyToken} testid="viewing-key" />
          </div>
          <div className="flex justify-center pt-2">
            <div className="rounded-xl bg-white p-3">
              <QRCodeSVG value={viewingKeyToken} size={150} bgColor="#ffffff" fgColor="#0a0a12" level="L" />
            </div>
          </div>
        </div>
      )}

      {section === "audit" && (
        <div className="card p-6 space-y-4">
          <p className="text-sm text-poof-muted">
            Paste any viewing key to reconstruct what it can see. Leave it blank to audit your own history.
          </p>
          <textarea data-testid="audit-input" className="input text-xs font-mono resize-none h-20"
            placeholder="veilvk1:…  (blank = your own viewing key)"
            value={vkInput} onChange={(e) => setVkInput(e.target.value)} />
          <button data-testid="audit-run" onClick={runAudit} disabled={auditing} className="btn-primary w-full">
            {auditing ? <><Spinner /> Replaying pool…</> : "Reveal received notes"}
          </button>

          {audited && (
            <div data-testid="audit-result" className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{audited.length} note{audited.length === 1 ? "" : "s"} visible</span>
                {audited.length > 0 && <span className="text-poof-muted">total {formatAmount(auditTotal, audited[0].note.currencyId)}</span>}
              </div>
              {audited.length === 0 ? (
                <p className="text-sm text-poof-muted">No notes addressed to this key.</p>
              ) : (
                <div className="divide-y divide-poof-border rounded-xl border border-poof-border">
                  {audited.map((a) => (
                    <div key={a.leafIndex} className="flex items-center justify-between px-3 py-2.5 text-sm">
                      <span className="tabular-nums font-medium">{formatAmount(a.note.amount, a.note.currencyId)}</span>
                      <span className="font-mono text-xs text-poof-muted">leaf #{a.leafIndex} · {a.commitmentHex.slice(0, 10)}…</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {section === "receipts" && (
        <div className="space-y-6">
          <div className="card p-6 space-y-3">
            <div className="font-medium">Generate a proof-of-payment</div>
            <p className="text-sm text-poof-muted">
              A receipt opens a single note's commitment so anyone can verify the exact value existed on-chain —
              without exposing your keys or any other note.
            </p>
            {ownNotes.length === 0 ? (
              <p className="text-sm text-poof-muted">No notes to attest yet.</p>
            ) : (
              <>
                <div className="divide-y divide-poof-border rounded-xl border border-poof-border">
                  {visibleNotes.map((n, i) => {
                    const idx = safeRcptPage * RECEIPTS_PAGE_SIZE + i; // global index into ownNotes
                    return (
                      <div key={n.leafIndex ?? idx} className="flex items-center justify-between px-3 py-2.5">
                        <span className="text-sm tabular-nums">{formatAmount(n.note.amount, n.note.currencyId)} <span className="text-poof-muted text-xs">leaf #{n.leafIndex}</span></span>
                        <button data-testid={`gen-receipt-${idx}`} onClick={() => generate(idx)} className="btn-ghost text-xs px-3 py-1.5">Receipt</button>
                      </div>
                    );
                  })}
                </div>
                {ownNotes.length > RECEIPTS_PAGE_SIZE && (
                  <div className="flex items-center justify-between pt-1">
                    <button
                      title="Previous page"
                      data-testid="receipts-prev"
                      onClick={() => setRcptPage((p) => Math.max(0, p - 1))}
                      disabled={safeRcptPage === 0}
                      className="h-8 w-8 grid place-items-center rounded-lg border border-poof-border text-poof-muted hover:text-poof-text hover:border-poof-lavender transition disabled:opacity-50"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </button>
                    <span className="text-xs text-poof-muted tabular-nums">Page {safeRcptPage + 1} of {rcptPageCount}</span>
                    <button
                      title="Next page"
                      data-testid="receipts-next"
                      onClick={() => setRcptPage((p) => Math.min(rcptPageCount - 1, p + 1))}
                      disabled={safeRcptPage >= rcptPageCount - 1}
                      className="h-8 w-8 grid place-items-center rounded-lg border border-poof-border text-poof-muted hover:text-poof-text hover:border-poof-lavender transition disabled:opacity-50"
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </>
            )}
            {generated && (
              <div className="space-y-2 pt-1">
                <div className="label">Receipt token</div>
                <div data-testid="generated-receipt" className="mono text-[11px] break-all bg-poof-surface rounded-xl p-3 border border-poof-border">{serializeReceipt(generated)}</div>
                <AddressBadge value={serializeReceipt(generated)} label="copy receipt" testid="copy-receipt" />
              </div>
            )}
          </div>

          <div className="card p-6 space-y-3">
            <div className="font-medium">Verify a receipt</div>
            <textarea data-testid="verify-input" className="input text-xs font-mono resize-none h-20"
              placeholder="veilrcpt1:…" value={rcptInput} onChange={(e) => setRcptInput(e.target.value)} />
            <button data-testid="verify-run" onClick={verify} disabled={verifying} className="btn-secondary w-full">
              {verifying ? <><Spinner /> Verifying…</> : "Verify"}
            </button>
            {verifyResult && (
              <div data-testid="verify-result" className={`rounded-xl border p-3 text-sm ${
                verifyResult.v.selfConsistent ? "border-poof-success/40 bg-poof-success/10" : "border-poof-danger/40 bg-poof-danger/10"
              }`}>
                <div className={`font-medium ${verifyResult.v.selfConsistent ? "text-poof-success" : "text-poof-danger"}`}>
                  {verifyResult.v.selfConsistent ? "✓ Commitment is mathematically valid" : "✗ Tampered — commitment does not match opening"}
                </div>
                <div className="mt-1 text-poof-muted text-xs">
                  Value: {formatAmount(BigInt(verifyResult.r.amount), verifyResult.r.currencyId)}
                </div>
                {verifyResult.v.onChain && (
                  <div className={`mt-1 text-xs ${verifyResult.v.onChain.present ? "text-poof-success" : "text-poof-warn"}`}>
                    {verifyResult.v.onChain.present
                      ? `✓ Found on-chain${verifyResult.v.onChain.leafIndexMatches ? " at the stated leaf" : " (leaf differs)"}`
                      : "Not found in current pool history (may be aged out of RPC)"}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
