import { useState } from "react";
import { useWallet } from "../store/wallet";
import { AmountInput, Spinner, useToast } from "../components/ui";
import CurrencySelect from "../components/CurrencySelect";
import TxProgress from "../components/TxProgress";
import { currencyById, toBaseUnits, fromBaseUnits, DEFAULT_CURRENCY_ID } from "../lib/currencies";

// A Poof address is encoded as `pubkey.encPubHex` for easy paste/QR.
function parseAddress(s: string): { pubkey: string; encPub: string } | null {
  const [pubkey, encPub] = s.trim().split(".");
  if (!pubkey || !encPub || !/^[0-9]+$/.test(pubkey) || !/^[0-9a-fA-F]{64}$/.test(encPub)) return null;
  return { pubkey, encPub };
}

export default function Send() {
  const { send, txs, balancesByCurrency, address } = useWallet();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [currencyId, setCurrencyId] = useState(DEFAULT_CURRENCY_ID);
  const [started, setStarted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [memo, setMemo] = useState("");
  const [showMemo, setShowMemo] = useState(false);
  const toast = useToast();
  const currency = currencyById(currencyId);
  const balance = balancesByCurrency[currencyId] ?? 0n;
  const tx = started ? txs.find((t) => t.kind === "transfer") : undefined;

  const submit = async () => {
    const addr = parseAddress(to);
    if (!addr) { toast.push("Invalid Poof address (expect pubkey.encpub)", "err"); return; }
    const a = toBaseUnits(amount, currency.decimals);
    if (a <= 0n) { toast.push("Enter an amount", "err"); return; }
    if (a > balance) { toast.push("Amount exceeds balance", "err"); return; }
    setBusy(true);
    setStarted(true);
    try {
      await send(currencyId, addr.pubkey, addr.encPub, a);
      toast.push(`Sent ${amount} ${currency.symbol} privately`, "ok");
      setTo(""); setAmount("");
    } catch (e: any) {
      toast.push(e.message ?? "send failed", "err");
    } finally { setBusy(false); }
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
          <div className="label">Recipient Poof address</div>
          <input data-testid="send-to" className="input mono text-sm" placeholder="pubkey.encpub" value={to} onChange={(e) => setTo(e.target.value)} />
          {address && (
            <button onClick={() => setTo(`${address.pubkey}.${address.encPub}`)} className="mt-1 text-xs text-poof-gold hover:underline">
              Send to myself (test)
            </button>
          )}
        </div>
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
        <button data-testid="send-submit" onClick={submit} disabled={busy} className="btn-primary w-full py-3">
          {busy ? <><Spinner /> Proving…</> : "Send privately"}
        </button>
      </div>

      {tx && <TxProgress tx={tx} />}
    </div>
  );
}
