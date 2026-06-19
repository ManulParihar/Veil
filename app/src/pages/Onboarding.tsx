import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useWallet } from "../store/wallet";
import { Logo, Spinner, AddressBadge, useToast } from "../components/ui";

export default function Onboarding() {
  const { initialised, seedHex, feeAccount, createIdentity, importIdentity, fundFeeAccount } = useWallet();
  const [mode, setMode] = useState<"intro" | "import">("intro");
  const [seedInput, setSeedInput] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const nav = useNavigate();

  const create = async () => {
    setBusy(true);
    try { await createIdentity(); } catch (e: any) { toast.push(e.message, "err"); } finally { setBusy(false); }
  };
  const doImport = async () => {
    const hex = seedInput.trim().replace(/^0x/, "");
    if (hex.length !== 64 || !/^[0-9a-fA-F]+$/.test(hex)) { toast.push("Seed must be 64 hex characters", "err"); return; }
    setBusy(true);
    try { await importIdentity(hex); } catch (e: any) { toast.push(e.message, "err"); } finally { setBusy(false); }
  };
  const fund = async () => {
    setBusy(true);
    try { await fundFeeAccount(); toast.push("Fee account funded", "ok"); nav("/"); }
    catch (e: any) { toast.push(e.message, "err"); } finally { setBusy(false); }
  };

  // Step 2: identity exists → back up seed + fund fee account
  if (initialised && seedHex) {
    return (
      <div className="min-h-full grid place-items-center p-6">
        <div className="w-full max-w-lg space-y-5 animate-fade-in">
          <div className="text-center">
            <Logo className="h-12 w-12 mx-auto" />
            <h1 className="text-2xl font-bold mt-3">Back up your identity</h1>
            <p className="text-veil-muted mt-1">This 32-byte seed controls your private notes. Store it safely — it cannot be recovered.</p>
          </div>
          <div className="card p-5">
            <div className="label">Your recovery seed</div>
            <div data-testid="seed-display" className="mono text-sm break-all bg-veil-surface rounded-xl p-3 border border-veil-border">{seedHex}</div>
            <div className="mt-3"><AddressBadge value={seedHex} label="seed" testid="copy-seed" /></div>
          </div>
          <div className="card p-5">
            <div className="font-medium">Fund your fee-payer account</div>
            <p className="text-sm text-veil-muted mt-1">A separate Stellar account pays network fees. Fund it instantly from the testnet friendbot.</p>
            {feeAccount && <div className="mt-2"><AddressBadge value={feeAccount.publicKey} label="account" /></div>}
            <button data-testid="fund-btn" onClick={fund} disabled={busy} className="btn-primary w-full mt-4">
              {busy ? <Spinner /> : null} {feeAccount?.funded ? "Continue" : "Fund with Friendbot"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Step 1: create / import
  return (
    <div className="min-h-full grid place-items-center p-6">
      <div className="w-full max-w-lg space-y-6 animate-fade-in">
        <div className="text-center">
          <Logo className="h-14 w-14 mx-auto" />
          <h1 className="text-3xl font-bold mt-4">Veil</h1>
          <p className="text-veil-muted mt-2 max-w-md mx-auto">
            A shielded pool on Stellar. Hold and transfer value privately —
            balances and recipients stay hidden behind zero-knowledge proofs.
          </p>
        </div>

        {mode === "intro" ? (
          <div className="card p-6 space-y-3">
            <button data-testid="create-btn" onClick={create} disabled={busy} className="btn-primary w-full py-3 text-base">
              {busy ? <Spinner /> : null} Create a new identity
            </button>
            <button onClick={() => setMode("import")} className="btn-ghost w-full">I have a seed</button>
            <p className="text-xs text-veil-muted text-center pt-1">No accounts, no signups. Your keys derive from a seed you control.</p>
          </div>
        ) : (
          <div className="card p-6 space-y-3">
            <div>
              <div className="label">Recovery seed (64 hex chars)</div>
              <input data-testid="seed-input" className="input mono" placeholder="a1b2c3…" value={seedInput}
                onChange={(e) => setSeedInput(e.target.value)} />
            </div>
            <button data-testid="import-btn" onClick={doImport} disabled={busy} className="btn-primary w-full">
              {busy ? <Spinner /> : null} Import identity
            </button>
            <button onClick={() => setMode("intro")} className="btn-ghost w-full">Back</button>
          </div>
        )}
        <div className="grid grid-cols-3 gap-3 text-center">
          {[["ZK", "real proofs"], ["BN254", "on-chain verify"], ["Soroban", "testnet"]].map(([a, b]) => (
            <div key={a} className="card p-3">
              <div className="font-semibold text-veil-primary">{a}</div>
              <div className="text-[11px] text-veil-muted">{b}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
