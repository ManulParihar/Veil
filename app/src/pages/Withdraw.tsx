import { useEffect, useState } from "react";
import { useWallet } from "../store/wallet";
import { AmountInput, Spinner, useToast } from "../components/ui";
import CurrencySelect from "../components/CurrencySelect";
import TxProgress from "../components/TxProgress";
import AnonymityMeter from "../components/AnonymityMeter";
import { currencyById, toBaseUnits, fromBaseUnits, formatAmount, DEFAULT_CURRENCY_ID } from "../lib/currencies";
import { relayerEnabled, getRelayerInfo, type RelayerInfo } from "../lib/relayer";

// A Stellar account address: G... (56 chars, base32).
const isStellarAddr = (s: string) => /^G[A-Z2-7]{55}$/.test(s.trim());

export default function Withdraw() {
  const { withdraw, withdrawViaRelayer, txs, balancesByCurrency, feeAccount } = useWallet();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [currencyId, setCurrencyId] = useState(DEFAULT_CURRENCY_ID);
  const [started, setStarted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [gasless, setGasless] = useState(false);
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
      if (gasless && relayer) {
        await withdrawViaRelayer(currencyId, amt, dest, relayer.relayerAddress, fee);
        toast.push(`Gasless withdrawal sent — recipient nets ${fromBaseUnits(recipientNets, currency.decimals)} ${currency.symbol}`, "ok");
      } else {
        await withdraw(currencyId, amt, dest);
        toast.push(`Withdrew ${amount} ${currency.symbol}`, "ok");
      }
      setAmount("");
    } catch (e: any) {
      toast.push(e.message ?? "withdraw failed", "err");
    } finally { setBusy(false); }
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

      {tx && <TxProgress tx={tx} />}
    </div>
  );
}
