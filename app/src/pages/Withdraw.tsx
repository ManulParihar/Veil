import { useEffect, useState } from "react";
import { useWallet } from "../store/wallet";
import { AmountInput, Spinner, useToast } from "../components/ui";
import CurrencySelect from "../components/CurrencySelect";
import TxProgress from "../components/TxProgress";
import AnonymityMeter from "../components/AnonymityMeter";
import MergeWarningModal from "../components/MergeWarningModal";
import MergeStatus from "../components/MergeStatus";
import { useMergePlans } from "../lib/useMergePlanner";
import { IMMEDIATE_MERGE_TTL_MS } from "../lib/mergePlan";
import { currencyById, toBaseUnits, fromBaseUnits, formatAmount, DEFAULT_CURRENCY_ID } from "../lib/currencies";
import { relayerEnabled, getRelayerInfo, type RelayerInfo } from "../lib/relayer";
import type { ConsolidationPlan } from "../lib/spendSelection";

// A Stellar account address: G... (56 chars, base32).
const isStellarAddr = (s: string) => /^G[A-Z2-7]{55}$/.test(s.trim());

export default function Withdraw() {
  const { withdraw, withdrawViaRelayer, previewConsolidation, consolidateNow, startDelegation, txs, balancesByCurrency, feeAccount } = useWallet();
  const { add: addMergePlan } = useMergePlans();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [currencyId, setCurrencyId] = useState(DEFAULT_CURRENCY_ID);
  const [started, setStarted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [gasless, setGasless] = useState(false);
  // multi-note merge UX (see Send.tsx): >4 notes opens the modal, 3–4 merge silently.
  const [mergePlan, setMergePlan] = useState<ConsolidationPlan | null>(null);
  const [relayer, setRelayer] = useState<RelayerInfo | null>(null);
  const [relayerErr, setRelayerErr] = useState<string | null>(null);
  const toast = useToast();
  const currency = currencyById(currencyId);
  const balance = balancesByCurrency[currencyId] ?? 0n;
  const tx = started ? txs.find((t) => t.kind === "withdraw") : undefined;
  const showGaslessOption = relayerEnabled();

  // fetch relayer info when the user opts into gasless
  useEffect(() => {
    if (!gasless || relayer) return;
    const ac = new AbortController();
    getRelayerInfo(ac.signal)
      .then((info) => { setRelayer(info); setRelayerErr(null); })
      .catch((e) => { setRelayerErr(String(e?.message ?? e)); setGasless(false); });
    return () => ac.abort();
  }, [gasless, relayer]);

  const fee = relayer?.minFee ?? 0n;
  const amt = toBaseUnits(amount, currency.decimals);
  const recipientNets = gasless ? amt - fee : amt;

  // The actual withdraw (gasless or direct), after any required note-merge.
  const doWithdraw = async (dest: string) => {
    if (gasless && relayer) {
      await withdrawViaRelayer(currencyId, amt, dest, relayer.relayerAddress, fee);
      toast.push(`Gasless withdrawal sent — recipient nets ${fromBaseUnits(recipientNets, currency.decimals)} ${currency.symbol}`, "ok");
    } else {
      await withdraw(currencyId, amt, dest);
      toast.push(`Withdrew ${amount} ${currency.symbol}`, "ok");
    }
    setAmount("");
  };

  // Merge notes into ≤2 spendable ones (progress shown by MergeStatus, which
  // reads the store so it persists across navigation), then withdraw.
  const mergeThenWithdraw = async (dest: string) => {
    await consolidateNow(currencyId, amt);
    await doWithdraw(dest);
  };

  const submit = async () => {
    const dest = to.trim();
    if (!isStellarAddr(dest)) { toast.push("Enter a valid Stellar address (G…)", "err"); return; }
    if (amt <= 0n) { toast.push("Enter an amount", "err"); return; }
    if (amt > balance) { toast.push("Amount exceeds shielded balance", "err"); return; }
    if (gasless) {
      if (!relayer) { toast.push("Relayer not ready", "err"); return; }
      if (amt <= fee) { toast.push(`Amount must exceed the relayer fee (${formatAmount(fee, currencyId)})`, "err"); return; }
    }
    setBusy(true);
    setStarted(true);
    try {
      const plan = await previewConsolidation(currencyId, amt);
      if (plan && plan.rounds >= 2) { setMergePlan(plan); return; } // >4 notes → ask
      if (plan && plan.rounds === 1) await mergeThenWithdraw(dest);  // 3–4 notes → silent
      else await doWithdraw(dest);                                   // ≤2 notes (or insufficient → throws)
    } catch (e: any) {
      toast.push(e.message ?? "withdraw failed", "err");
    } finally { setBusy(false); }
  };

  // Close the modal immediately and merge-then-withdraw in the background; progress
  // shows in MergeStatus and the app-wide indicator (store-backed). If delegate is
  // on, mint a session key first so the back-to-back merges sign silently — no
  // wallet prompt per step, and the run survives navigating away from Withdraw.
  const onDoItAnyways = async (delegate: boolean) => {
    const dest = to.trim();
    setMergePlan(null);
    setBusy(true);
    setStarted(true);
    if (delegate) {
      try { await startDelegation(IMMEDIATE_MERGE_TTL_MS); }
      catch (e: any) { toast.push(`Couldn't delegate signing: ${e?.message ?? e}`, "err"); }
    }
    mergeThenWithdraw(dest)
      .catch((e: any) => toast.push(e.message ?? "merge failed", "err"))
      .finally(() => setBusy(false));
  };

  // Schedule a paced merge; optionally delegate signing so it fires unattended.
  const onMergePrivately = async (deadlineSec: number, delegate: boolean) => {
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
      amountBase: amt,
      label: `${amount} ${currency.symbol}`,
      deadline: Date.now() + deadlineSec * 1000,
      rounds: mergePlan.rounds,
      totalMerges: mergePlan.totalMerges,
    });
    toast.push("Private merge scheduled — return later to withdraw", "ok");
  };

  return (
    <div className="max-w-md mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-poof-gold/15 grid place-items-center">
          <svg className="h-5 w-5 text-poof-gold" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7 7 7-7"/></svg>
        </div>
        <h1 className="text-2xl font-bold">Withdraw</h1>
      </div>

      <div className="card p-6 space-y-4">
        <div>
          <div className="label">Asset</div>
          <CurrencySelect value={currencyId} onChange={setCurrencyId} testid="withdraw-currency" />
        </div>
        <div>
          <div className="label">Destination Stellar address</div>
          <input data-testid="withdraw-to" className="input mono text-sm" placeholder="G…" value={to} onChange={(e) => setTo(e.target.value)} />
          {feeAccount && (
            <button onClick={() => setTo(feeAccount.publicKey)} className="mt-1 text-xs text-poof-gold hover:underline">
              To my fee account
            </button>
          )}
        </div>
        <div>
          <div className="label">Amount</div>
          <AmountInput value={amount} onChange={setAmount} max={fromBaseUnits(balance, currency.decimals)} unit={currency.symbol} testid="withdraw-amount" />
        </div>

        {showGaslessOption && (
          <div className="rounded-xl border border-poof-border bg-poof-surface/50 p-3.5 space-y-2">
            <label className="flex items-center justify-between cursor-pointer">
              <span className="flex items-center gap-2 text-sm font-medium">
                <svg className="h-4 w-4 text-poof-lavender" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z"/></svg>
                Gasless (via relayer)
              </span>
              <input type="checkbox" data-testid="gasless-toggle" checked={gasless} onChange={(e) => setGasless(e.target.checked)}
                className="h-4 w-4 accent-poof-lavender" />
            </label>
            <p className="text-xs text-poof-muted">
              A relayer submits and pays the network fee — your destination never needs XLM, and no fee-payer links to you.
            </p>
            {relayerErr && <div className="text-xs text-poof-danger">Relayer unavailable: {relayerErr}</div>}
            {gasless && relayer && (
              <div className="text-xs space-y-1 pt-1 border-t border-poof-border/60">
                <div className="flex justify-between"><span className="text-poof-muted">Relayer fee</span><span className="tabular-nums">{formatAmount(fee, currencyId)}</span></div>
                <div className="flex justify-between"><span className="text-poof-muted">Recipient receives</span><span className="tabular-nums text-poof-text">{amt > 0n ? formatAmount(recipientNets > 0n ? recipientNets : 0n, currencyId) : "—"}</span></div>
              </div>
            )}
            {gasless && !relayer && !relayerErr && (
              <div className="flex items-center gap-2 text-xs text-poof-muted"><Spinner className="h-3.5 w-3.5" /> contacting relayer…</div>
            )}
          </div>
        )}

        <AnonymityMeter currencyId={currencyId} />
        <button data-testid="withdraw-submit" onClick={submit} disabled={busy} className="btn-primary w-full py-3">
          {busy ? <><Spinner /> Proving…</> : gasless ? "Withdraw (gasless)" : "Withdraw to Stellar"}
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
