import { useState } from "react";
import { useWallet } from "../store/wallet";
import { AmountInput, Spinner, useToast } from "../components/ui";
import CurrencySelect from "../components/CurrencySelect";
import TxProgress from "../components/TxProgress";
import { currencyById, toBaseUnits, fromBaseUnits, DEFAULT_CURRENCY_ID } from "../lib/currencies";

// A Stellar account address: G... (56 chars, base32).
const isStellarAddr = (s: string) => /^G[A-Z2-7]{55}$/.test(s.trim());

export default function Withdraw() {
  const { withdraw, txs, balancesByCurrency, feeAccount } = useWallet();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [currencyId, setCurrencyId] = useState(DEFAULT_CURRENCY_ID);
  const [started, setStarted] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const currency = currencyById(currencyId);
  const balance = balancesByCurrency[currencyId] ?? 0n;
  const tx = started ? txs.find((t) => t.kind === "withdraw") : undefined;

  const submit = async () => {
    const dest = to.trim();
    if (!isStellarAddr(dest)) { toast.push("Enter a valid Stellar address (G…)", "err"); return; }
    const a = toBaseUnits(amount, currency.decimals);
    if (a <= 0n) { toast.push("Enter an amount", "err"); return; }
    if (a > balance) { toast.push("Amount exceeds shielded balance", "err"); return; }
    setBusy(true);
    setStarted(true);
    try {
      await withdraw(currencyId, a, dest);
      toast.push(`Withdrew ${amount} ${currency.symbol}`, "ok");
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
        <button data-testid="withdraw-submit" onClick={submit} disabled={busy} className="btn-primary w-full py-3">
          {busy ? <><Spinner /> Proving…</> : "Withdraw to Stellar"}
        </button>
      </div>

      {tx && <TxProgress tx={tx} />}
    </div>
  );
}
