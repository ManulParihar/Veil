import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useWallet } from "../store/wallet";
import { Logo, Spinner, AddressBadge, ExplorerLink, SecretReveal, useToast } from "../components/ui";
import PoofSparkle from "../components/PoofSparkle";
import { MagicTextReveal } from "../components/fx/MagicTextReveal";
import { fromStroops, EXPLORER_ACCOUNT } from "../lib/types";

export default function Onboarding() {
  const {
    initialised, seedHex, feeAccount, balanceShielded, notes, signerKind,
    createIdentity, importIdentity, connectWallet, fundFeeAccount, scanForNotes,
  } = useWallet();
  const isWallet = signerKind === "wallet";
  const [mode, setMode] = useState<"intro" | "import">("intro");
  const [recovered, setRecovered] = useState(false);
  const [seedInput, setSeedInput] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const nav = useNavigate();

  const create = async () => {
    setBusy(true);
    setRecovered(false);
    try { await createIdentity(); } catch (e: any) { toast.push(e.message, "err"); } finally { setBusy(false); }
  };
  const connect = async () => {
    setBusy(true);
    setRecovered(false);
    try {
      await connectWallet();
      toast.push("Wallet connected", "ok");
    } catch (e: any) {
      toast.push(e?.message ?? "wallet connection failed", "err");
    } finally { setBusy(false); }
  };
  const doImport = async () => {
    const hex = seedInput.trim().replace(/^0x/, "");
    if (hex.length !== 64 || !/^[0-9a-fA-F]+$/.test(hex)) { toast.push("Seed must be 64 hex characters", "err"); return; }
    setBusy(true);
    try {
      await importIdentity(hex);
      // recovery: rediscover this seed's notes from the chain (restores balance)
      const n = await scanForNotes();
      setRecovered(true);
      toast.push(n > 0 ? `Recovered ${n} note${n > 1 ? "s" : ""}` : "Identity restored — no notes found yet", n > 0 ? "ok" : "info");
    } catch (e: any) { toast.push(e.message, "err"); } finally { setBusy(false); }
  };
  const fund = async () => {
    setBusy(true);
    try {
      // A recovered account is often already funded on-chain; don't re-run
      // friendbot, just continue into the app.
      if (!feeAccount?.funded) {
        await fundFeeAccount();
        toast.push("Fee account funded", "ok");
      }
      // with a funded account we can reconcile spent state precisely
      if (recovered) await scanForNotes().catch(() => {});
      nav("/app");
    } catch (e: any) { toast.push(e.message, "err"); } finally { setBusy(false); }
  };

  // Step 2: identity exists → (recovery) welcome back / (create) back up seed, then fund
  if (initialised && seedHex) {
    return (
      <div className="min-h-full grid place-items-center p-6">
        <div className="w-full max-w-lg space-y-5 animate-fade-in">
          <div className="text-center">
            <div className="relative inline-block">
              <Logo className="h-12 w-12 mx-auto" />
              <PoofSparkle active className="w-12 h-12 -mt-3 -mr-3 absolute top-0 right-0" />
            </div>
            <h1 className="text-2xl font-bold mt-3">
              {recovered ? "Welcome back" : isWallet ? "Wallet connected" : "Back up your identity"}
            </h1>
            <p className="text-poof-muted mt-1">
              {recovered
                ? "Identity restored. Fund your account to continue."
                : isWallet
                ? "Reconnect any time to restore your shielded identity."
                : "Save this seed. It controls your private notes."}
            </p>
          </div>
          {recovered ? (
            <div className="card p-5" data-testid="recovered-summary">
              <div className="flex items-center justify-between">
                <div className="text-sm text-poof-muted">Recovered shielded balance</div>
                <div className="text-xs text-poof-muted">{notes.filter((n) => !n.spent && !n.invalidReason).length} notes</div>
              </div>
              <div data-testid="recovered-balance" className="text-3xl font-bold mt-1 tabular-nums">{fromStroops(balanceShielded)} <span className="text-lg text-poof-muted">XLM</span></div>
            </div>
          ) : isWallet ? null : (
            <div className="card p-5">
              <div className="label">Your recovery seed</div>
              <SecretReveal value={seedHex} testid="seed-display" />
            </div>
          )}
          <div className="card p-5">
            <div className="font-medium">{isWallet ? "Fund your account" : "Fund your fee-payer account"}</div>
            <p className="text-sm text-poof-muted mt-1">
              {isWallet
                ? "Fund your wallet with testnet XLM for fees."
                : "Fund this account to pay network fees."}
            </p>
            {feeAccount && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <AddressBadge value={feeAccount.publicKey} label={isWallet ? "wallet" : "account"} testid="fee-account" />
                <ExplorerLink url={EXPLORER_ACCOUNT + feeAccount.publicKey} testid="fee-account-explorer" />
              </div>
            )}
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
        <div className="text-center flex flex-col items-center">
          <div className="relative">
            <span className="smoke-wisp h-12 w-12 left-1/2 -translate-x-1/2 -top-3 animate-smoke-rise" />
            <Logo className="h-14 w-14 relative animate-float" />
          </div>
          {/* The wordmark literally poofs: hover to condense the smoke into "Poof". */}
          <MagicTextReveal
            text="Poof"
            color="rgba(232, 213, 163, 1)"
            fontSize={84}
            fontWeight={800}
            density={5}
            spread={24}
            className="mt-1 -mb-2"
          />
          <p className="text-xs text-poof-muted/80 -mt-1">hover the smoke ✨</p>
          <p className="text-poof-muted mt-3">Private payments on Stellar — powered by zero-knowledge proofs.</p>
        </div>

        {mode === "intro" ? (
          <div className="card p-6 space-y-3">
            <button data-testid="create-btn" onClick={create} disabled={busy} className="btn-primary w-full py-3 text-base">
              {busy ? <Spinner /> : null} Create a new identity
            </button>
            <button data-testid="connect-wallet-btn" onClick={connect} disabled={busy} className="btn-secondary w-full py-3 text-base">
              {busy ? <Spinner /> : null} Connect wallet
            </button>
            <button onClick={() => setMode("import")} className="btn-ghost w-full">I have a seed</button>
            <p className="text-xs text-poof-muted text-center pt-1">No accounts, no signups.</p>
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
            <div key={a} className="card glow-ring p-3 transition">
              <div className="font-semibold text-magic">{a}</div>
              <div className="text-[11px] text-poof-muted">{b}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
