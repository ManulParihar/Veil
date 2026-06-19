import { useState } from "react";
import { useWallet } from "../store/wallet";
import { AmountInput, Spinner, useToast } from "../components/ui";
import TxProgress from "../components/TxProgress";

// A Veil address is encoded as `pubkey.encPubHex` for easy paste/QR.
function parseAddress(s: string): { pubkey: string; encPub: string } | null {
  const [pubkey, encPub] = s.trim().split(".");
  if (!pubkey || !encPub || !/^[0-9]+$/.test(pubkey) || !/^[0-9a-fA-F]{64}$/.test(encPub)) return null;
  return { pubkey, encPub };
}

export default function Send() {
  const { send, txs, balanceShielded, address } = useWallet();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [started, setStarted] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const tx = started ? txs.find((t) => t.kind === "transfer") : undefined;

  const submit = async () => {
    const addr = parseAddress(to);
    if (!addr) { toast.push("Invalid Veil address (expect pubkey.encpub)", "err"); return; }
    const a = BigInt(amount || "0");
    if (a <= 0n) { toast.push("Enter an amount", "err"); return; }
    if (a > balanceShielded) { toast.push("Amount exceeds balance", "err"); return; }
    setBusy(true);
    setStarted(true);
    try {
      await send(addr.pubkey, addr.encPub, a);
      toast.push(`Sent ${a} VEIL privately`, "ok");
      setTo(""); setAmount("");
    } catch (e: any) {
      toast.push(e.message ?? "send failed", "err");
    } finally { setBusy(false); }
  };

  return (
    <div className="max-w-md mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Send</h1>
        <p className="text-veil-muted text-sm">A shielded transfer. The recipient and amount are hidden; only an unlinkable nullifier and new commitments appear on-chain.</p>
      </div>

      <div className="card p-6 space-y-4">
        <div>
          <div className="label">Recipient Veil address</div>
          <input data-testid="send-to" className="input mono text-sm" placeholder="pubkey.encpub" value={to} onChange={(e) => setTo(e.target.value)} />
          {address && (
            <button onClick={() => setTo(`${address.pubkey}.${address.encPub}`)} className="mt-1 text-xs text-veil-primary hover:underline">
              Send to myself (test)
            </button>
          )}
        </div>
        <div>
          <div className="label">Amount</div>
          <AmountInput value={amount} onChange={setAmount} max={balanceShielded} testid="send-amount" />
        </div>
        <button data-testid="send-submit" onClick={submit} disabled={busy} className="btn-primary w-full py-3">
          {busy ? <><Spinner /> Proving…</> : "Send privately"}
        </button>
      </div>

      {tx && <TxProgress tx={tx} />}
    </div>
  );
}
