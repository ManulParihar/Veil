import { useState } from "react";
import { useWallet } from "../store/wallet";
import { AmountInput, Spinner, useToast } from "../components/ui";
import CurrencySelect from "../components/CurrencySelect";
import TxProgress from "../components/TxProgress";
import { currencyById, toBaseUnits, DEFAULT_CURRENCY_ID } from "../lib/currencies";
import { faucetFor, faucetSecret } from "../lib/faucet";

export default function Deposit() {
  const { deposit, faucetDrip, txs, feeAccount, getSigner } = useWallet();
  // Deposit pulls tokens via a Soroban require_auth, which needs signAuthEntry.
  // Some external wallets can't sign auth entries — gate the action for them.
  const canDeposit = (() => { try { return getSigner().canSignAuthEntry; } catch { return false; } })();
  const [amount, setAmount] = useState("");
  const [currencyId, setCurrencyId] = useState(DEFAULT_CURRENCY_ID);
  const [started, setStarted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [faucetBusy, setFaucetBusy] = useState(false);
  const toast = useToast();
  const currency = currencyById(currencyId);
  const faucet = faucetFor(currencyId);
  // txs is newest-first; the latest deposit is the active one once we've started.
  const tx = started ? txs.find((t) => t.kind === "deposit") : undefined;

  const drip = async () => {
    if (!faucetSecret()) {
      toast.push("Faucet not configured (set VITE_VUSD_FAUCET_SECRET)", "err");
      return;
    }
    setFaucetBusy(true);
    try {
      await faucetDrip(currencyId);
      toast.push(`Dripped ${faucet!.dripAmount} ${currency.symbol} to your fee account`, "ok");
    } catch (e: any) {
      toast.push(e.message ?? "faucet failed", "err");
    } finally {
      setFaucetBusy(false);
    }
  };

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
          {faucet && (
            <button
              data-testid="faucet-vusd"
              onClick={drip}
              disabled={faucetBusy}
              className="btn-ghost mt-2 w-full py-2 text-sm"
            >
              {faucetBusy ? <><Spinner /> Dripping…</> : `Faucet: get ${faucet.dripAmount} ${currency.symbol}`}
            </button>
          )}
        </div>
        <div>
          <div className="label">Amount</div>
          <AmountInput value={amount} onChange={setAmount} testid="deposit-amount" />
        </div>
        <button
          data-testid="deposit-submit"
          onClick={submit}
          disabled={busy || !canDeposit}
          title={canDeposit ? undefined : "Your connected wallet can't sign Soroban auth entries — use Freighter or xBull to deposit."}
          className="btn-primary w-full py-3"
        >
          {busy ? <><Spinner /> Working…</> : "Deposit privately"}
        </button>
        {!canDeposit && (
          <p data-testid="deposit-unsupported" className="text-xs text-veil-warn">
            Your connected wallet can't authorize Soroban deposits. Send, withdraw and
            the faucet still work — to deposit, connect Freighter or xBull.
          </p>
        )}
        <p className="text-xs text-veil-muted">
          Real testnet XLM is custodied by the pool contract. Withdraw any time to a
          Stellar address — the amount and recipient stay private until then.
        </p>
      </div>

      {tx && <TxProgress tx={tx} />}
    </div>
  );
}
