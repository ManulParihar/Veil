import { useState } from "react";
import { useWallet } from "../store/wallet";
import { AmountInput, Spinner, useToast } from "../components/ui";
import TxProgress from "../components/TxProgress";
import { toStroops } from "../lib/types";

export default function Deposit() {
  const { deposit, txs, feeAccount } = useWallet();
  const [amount, setAmount] = useState("");
  const [started, setStarted] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  // txs is newest-first; the latest deposit is the active one once we've started.
  const tx = started ? txs.find((t) => t.kind === "deposit") : undefined;

  const submit = async () => {
    const a = toStroops(amount);
    if (a <= 0n) { toast.push("Enter an amount", "err"); return; }
    if (!feeAccount?.funded) { toast.push("Fund your fee account first", "err"); return; }
    setBusy(true);
    setStarted(true);
    try {
      await deposit(a);
      toast.push(`Deposited ${amount} XLM`, "ok");
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
