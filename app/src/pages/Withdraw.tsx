import { useState } from "react";
import { useWallet } from "../store/wallet";
import { AmountInput, Spinner, useToast } from "../components/ui";
import TxProgress from "../components/TxProgress";
import { toStroops, fromStroops } from "../lib/types";

// A Stellar account address: G... (56 chars, base32).
const isStellarAddr = (s: string) => /^G[A-Z2-7]{55}$/.test(s.trim());

export default function Withdraw() {
  const { withdraw, txs, balanceShielded, feeAccount } = useWallet();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [started, setStarted] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const tx = started ? txs.find((t) => t.kind === "withdraw") : undefined;

  const submit = async () => {
    const dest = to.trim();
    if (!isStellarAddr(dest)) { toast.push("Enter a valid Stellar address (G…)", "err"); return; }
    const a = toStroops(amount);
    if (a <= 0n) { toast.push("Enter an amount", "err"); return; }
    if (a > balanceShielded) { toast.push("Amount exceeds shielded balance", "err"); return; }
    setBusy(true);
    setStarted(true);
    try {
      await withdraw(a, dest);
      toast.push(`Withdrew ${amount} XLM`, "ok");
      setAmount("");
    } catch (e: any) {
      toast.push(e.message ?? "withdraw failed", "err");
    } finally { setBusy(false); }
  };

  return (
    <div className="max-w-md mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Withdraw</h1>
        <p className="text-veil-muted text-sm">Unshield XLM to any Stellar account. The pool releases real testnet XLM; your spend stays private (only an unlinkable nullifier appears).</p>
      </div>

      <div className="card p-6 space-y-4">
        <div>
          <div className="label">Destination Stellar address</div>
          <input data-testid="withdraw-to" className="input mono text-sm" placeholder="G…" value={to} onChange={(e) => setTo(e.target.value)} />
          {feeAccount && (
            <button onClick={() => setTo(feeAccount.publicKey)} className="mt-1 text-xs text-veil-primary hover:underline">
              To my fee account
            </button>
          )}
        </div>
        <div>
          <div className="label">Amount</div>
          <AmountInput value={amount} onChange={setAmount} max={fromStroops(balanceShielded)} testid="withdraw-amount" />
        </div>
        <button data-testid="withdraw-submit" onClick={submit} disabled={busy} className="btn-primary w-full py-3">
          {busy ? <><Spinner /> Proving…</> : "Withdraw to Stellar"}
        </button>
      </div>

      {tx && <TxProgress tx={tx} />}
    </div>
  );
}
