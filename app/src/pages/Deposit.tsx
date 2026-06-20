import { useState } from "react";
import { useWallet } from "../store/wallet";
import { AmountInput, Spinner, useToast } from "../components/ui";
import CurrencySelect from "../components/CurrencySelect";
import TxProgress from "../components/TxProgress";
import { currencyById, toBaseUnits, DEFAULT_CURRENCY_ID } from "../lib/currencies";

export default function Deposit() {
  const { deposit, txs, feeAccount } = useWallet();
  const [amount, setAmount] = useState("");
  const [currencyId, setCurrencyId] = useState(DEFAULT_CURRENCY_ID);
  const [started, setStarted] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const currency = currencyById(currencyId);
  // txs is newest-first; the latest deposit is the active one once we've started.
  const tx = started ? txs.find((t) => t.kind === "deposit") : undefined;

  const submit = async () => {
    const a = toBaseUnits(amount, currency.decimals);
    if (a <= 0n) { toast.push("Enter an amount", "err"); return; }
    if (!feeAccount?.funded) { toast.push("Fund your fee account first", "err"); return; }
    setBusy(true);
    setStarted(true);
    try {
      await deposit(currencyId, a);
      toast.push(`Deposited ${amount} ${currency.symbol}`, "ok");
      setAmount("");
    } catch (e: any) {
      toast.push(e.message ?? "deposit failed", "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-md mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Deposit</h1>
        <p className="text-veil-muted text-sm">Shield real testnet XLM. Your fee account's XLM is pulled into the pool and a private note is minted — proven in your browser, verified on-chain.</p>
      </div>

      <div className="card p-6 space-y-4">
        <div>
          <div className="label">Asset</div>
          <CurrencySelect value={currencyId} onChange={setCurrencyId} testid="deposit-currency" />
        </div>
        <div>
          <div className="label">Amount</div>
          <AmountInput value={amount} onChange={setAmount} testid="deposit-amount" />
        </div>
        <button data-testid="deposit-submit" onClick={submit} disabled={busy} className="btn-primary w-full py-3">
          {busy ? <><Spinner /> Working…</> : "Deposit privately"}
        </button>
        <p className="text-xs text-veil-muted">
          Real testnet XLM is custodied by the pool contract. Withdraw any time to a
          Stellar address — the amount and recipient stay private until then.
        </p>
      </div>

      {tx && <TxProgress tx={tx} />}
    </div>
  );
}
