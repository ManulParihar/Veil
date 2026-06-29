import { useEffect, useMemo, useState } from "react";
import { useWallet } from "../store/wallet";
import { AmountInput, Spinner, useToast } from "../components/ui";
import CurrencySelect from "../components/CurrencySelect";
import TxProgress from "../components/TxProgress";
import AnonymityMeter from "../components/AnonymityMeter";
import MergeWarningModal from "../components/MergeWarningModal";
import MergeStatus from "../components/MergeStatus";
import { useMergePlans } from "../lib/useMergePlanner";
import { IMMEDIATE_MERGE_TTL_MS } from "../lib/mergePlan";
import { currencyById, toBaseUnits, fromBaseUnits, DEFAULT_CURRENCY_ID } from "../lib/currencies";
import { parsePaymentLink } from "../lib/paymentLink";
import type { ConsolidationPlan } from "../lib/spendSelection";

export default function Send() {
  const { send, previewConsolidation, consolidateNow, startDelegation, txs, balancesByCurrency, address } = useWallet();
  const { add: addMergePlan } = useMergePlans();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [currencyId, setCurrencyId] = useState(DEFAULT_CURRENCY_ID);
  const [started, setStarted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [memo, setMemo] = useState("");
  const [showMemo, setShowMemo] = useState(false);
  // multi-note merge UX: a >4-note spend opens the warning modal; a 3–4-note spend
  // merges silently first. `prep` drives the live merge-progress banner.
  const [mergePlan, setMergePlan] = useState<ConsolidationPlan | null>(null);
  // track which request link we've already auto-applied so we don't fight edits
  const [appliedLink, setAppliedLink] = useState<string | null>(null);
  const toast = useToast();
  const currency = currencyById(currencyId);
  const balance = balancesByCurrency[currencyId] ?? 0n;
  // sending to your own address is recorded as a self-transfer ("self"), so track
  // either kind for the in-flight progress display.
  const tx = started ? txs.find((t) => t.kind === "transfer" || t.kind === "self") : undefined;

  // Parse whatever is in the recipient box as a payment request (veil: URI or
  // bare address). Drives both validation and the "request detected" banner.
  const parsed = useMemo(() => parsePaymentLink(to), [to]);
  const isRequest = !!parsed && (!!parsed.amount || !!parsed.label || parsed.currencyId != null || !!parsed.memo);

  // When a NEW request link is pasted, prefill its fields once.
  useEffect(() => {
    if (!parsed || !to || to === appliedLink) return;
    if (!isRequest) return;
    if (parsed.currencyId != null) setCurrencyId(parsed.currencyId);
    if (parsed.amount) setAmount(parsed.amount);
    if (parsed.memo) { setMemo(parsed.memo); setShowMemo(true); }
    setAppliedLink(to);
    toast.push("Payment request applied", "info");
  }, [parsed, to, appliedLink, isRequest, toast]);

  // The actual private send, after any required note-merge has run.
  const doSend = async (a: bigint) => {
    await send(currencyId, parsed!.pubkey, parsed!.encPub, a);
    toast.push(`Sent ${amount} ${currency.symbol} privately`, "ok");
    setTo(""); setAmount(""); setMemo(""); setAppliedLink(null);
  };

  // Merge notes into ≤2 spendable ones (progress shown by MergeStatus, which
  // reads the store so it persists across navigation), then send.
  const mergeThenSend = async (a: bigint) => {
    await consolidateNow(currencyId, a);
    await doSend(a);
  };

  const submit = async () => {
    if (!parsed) { toast.push("Invalid Veil address (expect pubkey.encpub or a veil: link)", "err"); return; }
    const a = toBaseUnits(amount, currency.decimals);
    if (a <= 0n) { toast.push("Enter an amount", "err"); return; }
    if (a > balance) { toast.push("Amount exceeds balance", "err"); return; }
    setBusy(true);
    setStarted(true);
    try {
      const plan = await previewConsolidation(currencyId, a);
      if (plan && plan.rounds >= 2) {
        // >4 notes: let the user choose burst vs. private. Modal drives the rest.
        setMergePlan(plan);
        return;
      }
      if (plan && plan.rounds === 1) await mergeThenSend(a); // 3–4 notes: silent merge
      else await doSend(a);                                   // ≤2 notes (or insufficient → throws)
    } catch (e: any) {
      toast.push(e.message ?? "send failed", "err");
    } finally { setBusy(false); }
  };

  // "Do it anyways": merge everything now (back-to-back), then send. Close the
  // modal right away and run in the background — progress shows in MergeStatus and
  // the app-wide indicator (store-backed), so the user isn't trapped on a spinner.
  // If delegate is on, mint a session key first so the back-to-back merges (and
  // the trailing send) sign silently — no wallet prompt per step, and the run
  // survives navigating away from Send.
  const onDoItAnyways = async (delegate: boolean) => {
    const a = toBaseUnits(amount, currency.decimals);
    setMergePlan(null);
    setBusy(true);
    setStarted(true);
    if (delegate) {
      try { await startDelegation(IMMEDIATE_MERGE_TTL_MS); }
      catch (e: any) { toast.push(`Couldn't delegate signing: ${e?.message ?? e}`, "err"); }
    }
    mergeThenSend(a)
      .catch((e: any) => toast.push(e.message ?? "merge failed", "err"))
      .finally(() => setBusy(false));
  };

  // "Merge privately": schedule a paced, randomized consolidation by a deadline.
  // Optionally delegate signing (session key) so steps fire unattended.
  const onMergePrivately = async (deadlineSec: number, delegate: boolean) => {
    const a = toBaseUnits(amount, currency.decimals);
    if (!mergePlan) return;
    setMergePlan(null);
    if (delegate) {
      // Cover the whole deadline window (+ settle buffer), but never less than the
      // immediate-burst TTL — a short deadline shouldn't expire the delegation
      // partway and pause the plan for re-authorization.
      try { await startDelegation(Math.max(deadlineSec * 1000 + 60_000, IMMEDIATE_MERGE_TTL_MS)); }
      catch (e: any) { toast.push(`Couldn't delegate signing: ${e?.message ?? e}`, "err"); }
    }
    addMergePlan({
      currencyId,
      amountBase: a,
      label: `${amount} ${currency.symbol}`,
      deadline: Date.now() + deadlineSec * 1000,
      rounds: mergePlan.rounds,
      totalMerges: mergePlan.totalMerges,
    });
    toast.push("Private merge scheduled — return later to send or withdraw", "ok");
  };

  return (
    <div className="max-w-md mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-poof-lavender/15 grid place-items-center">
          <svg className="h-5 w-5 text-poof-lavender" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
        </div>
        <h1 className="text-2xl font-bold">Send</h1>
      </div>

      <div className="card p-6 space-y-4">
        <div>
          <div className="label">Asset</div>
          <CurrencySelect value={currencyId} onChange={setCurrencyId} testid="send-currency" />
        </div>
        <div>
          <div className="label">Recipient address or veil: link</div>
          <input data-testid="send-to" className="input mono text-sm" placeholder="pubkey.encpub  or  veil:…" value={to} onChange={(e) => setTo(e.target.value)} />
          {to && !parsed && <div className="mt-1 text-xs text-poof-danger">Not a valid Veil address or link.</div>}
          {address && (
            <button onClick={() => { setTo(`${address.pubkey}.${address.encPub}`); setAppliedLink(null); }} className="mt-1 text-xs text-poof-gold hover:underline">
              Send to myself (test)
            </button>
          )}
        </div>

        {isRequest && parsed && (
          <div data-testid="request-banner" className="animate-fade-in rounded-xl border border-poof-gold/40 bg-poof-gold/10 p-3">
            <div className="flex items-center gap-2 text-sm font-medium text-poof-gold">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 7L9 18l-5-5"/></svg>
              Payment request detected
            </div>
            {parsed.label && <div className="mt-1 text-sm text-poof-text">{parsed.label}</div>}
            {parsed.amount && (
              <div className="mt-0.5 text-xs text-poof-muted">
                Asking for {parsed.amount} {currencyById(parsed.currencyId ?? 0).symbol}
              </div>
            )}
          </div>
        )}

        <div>
          <div className="label">Amount</div>
          <AmountInput value={amount} onChange={setAmount} max={fromBaseUnits(balance, currency.decimals)} unit={currency.symbol} testid="send-amount" />
        </div>
        <div>
          <button
            type="button"
            onClick={() => setShowMemo(!showMemo)}
            className="flex items-center gap-2 text-xs text-poof-muted hover:text-poof-text transition"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
            </svg>
            {showMemo ? "Hide memo" : "Add private memo"}
            <svg className={`h-3 w-3 transition-transform ${showMemo ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>
          </button>
          {showMemo && (
            <div className="mt-2 animate-fade-in">
              <textarea
                className="input text-sm resize-none h-20"
                placeholder="Encrypted — only the recipient sees this"
                maxLength={192}
                value={memo}
                onChange={(e) => setMemo(e.target.value.slice(0, 192))}
              />
              <div className="text-right text-[10px] text-poof-muted mt-1 tabular-nums">{memo.length}/192</div>
            </div>
          )}
        </div>
        <AnonymityMeter currencyId={currencyId} />
        <button data-testid="send-submit" onClick={submit} disabled={busy} className="btn-primary w-full py-3">
          {busy ? <><Spinner /> Proving…</> : "Send privately"}
        </button>
      </div>

      <MergeStatus currencyId={currencyId} />
      {tx && <TxProgress tx={tx} />}

      {mergePlan && (
        <MergeWarningModal
          noteCount={mergePlan.noteCount}
          amountLabel={`${amount} ${currency.symbol}`}
          onClose={() => setMergePlan(null)}
          onDoItAnyways={onDoItAnyways}
          onMergePrivately={onMergePrivately}
        />
      )}
    </div>
  );
}
