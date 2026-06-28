import { useState } from "react";
import { Shuffle } from "lucide-react";
import { useWallet } from "../store/wallet";
import { Spinner, useToast } from "./ui";
import CurrencySelect from "./CurrencySelect";
import { type DecoyRoundInfo } from "../lib/decoy";
import { DEFAULT_CURRENCY_ID, currencyById, formatAmount } from "../lib/currencies";

// Randomized-delay presets (seconds). Real privacy wants gaps; demos want speed.
const SPEEDS = [
  { id: "demo", label: "Demo", min: 1, max: 3 },
  { id: "natural", label: "Natural", min: 20, max: 90 },
  { id: "paranoid", label: "Paranoid", min: 120, max: 600 },
] as const;

export default function DecoyBooster() {
  // Run state lives in the store so it survives this component unmounting on
  // navigation; only the form inputs are local.
  const { address, balancesByCurrency, signerKind, decoyRunning, decoyProgress, startDecoy, stopDecoy } = useWallet();
  const toast = useToast();
  const [currencyId, setCurrencyId] = useState(DEFAULT_CURRENCY_ID);
  const [rounds, setRounds] = useState(3);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]["id"]>("demo");
  const [delegate, setDelegate] = useState(true);

  const running = decoyRunning;
  const progress: DecoyRoundInfo | null = decoyProgress;
  const balance = balancesByCurrency[currencyId] ?? 0n;
  const sym = currencyById(currencyId).symbol;
  const preset = SPEEDS.find((s) => s.id === speed)!;
  // Only external wallets prompt per-tx; local identities already sign silently.
  const canDelegate = signerKind === "wallet";

  const start = async () => {
    if (!address) return;
    if (balance <= 0n) { toast.push(`No shielded ${sym} to remix`, "err"); return; }
    try {
      // The session key (if delegated) is shared and session-scoped — startDecoy
      // reuses/extends it and never revokes it, so a running schedule's delegation
      // survives the decoy run.
      const done = await startDecoy({
        rounds, currencyId, minDelaySec: preset.min, maxDelaySec: preset.max,
        delegate: canDelegate && delegate,
      });
      toast.push(done > 0 ? `Ran ${done} decoy transfer${done === 1 ? "" : "s"}` : "No decoys ran", done > 0 ? "ok" : "info");
    } catch (e: any) {
      toast.push(e?.message ?? "decoy run failed", "err");
    }
  };

  const stop = () => stopDecoy();

  const phaseText = (p: DecoyRoundInfo) =>
    p.phase === "waiting" ? `Round ${p.round}/${p.total} — waiting (random delay)…`
    : p.phase === "sending" ? `Round ${p.round}/${p.total} — remixing ${formatAmount(p.amount, p.currencyId)}…`
    : p.phase === "done" ? `Round ${p.round}/${p.total} — done`
    : `Round ${p.round}/${p.total} — ${p.error}`;

  return (
    <div className="card glow-ring p-5 space-y-4" data-testid="decoy-booster">
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 rounded-lg bg-poof-gold/15 grid place-items-center">
          <Shuffle className="h-4 w-4 text-poof-gold" />
        </div>
        <div>
          <div className="text-sm font-medium">Decoy booster</div>
          <div className="text-xs text-poof-muted">Randomized self-transfers fatten the pool & break timing links</div>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <div className="label">Asset</div>
          <CurrencySelect value={currencyId} onChange={setCurrencyId} testid="decoy-currency" />
        </div>
        <div>
          <div className="label">Rounds</div>
          <div className="flex gap-1.5">
            {[1, 3, 5].map((r) => (
              <button key={r} onClick={() => setRounds(r)} disabled={running}
                className={`flex-1 rounded-lg px-3 py-2.5 text-sm font-medium border transition ${
                  rounds === r ? "border-poof-gold/50 bg-poof-gold/10 text-poof-gold" : "border-poof-border text-poof-muted hover:text-poof-text"
                }`}>{r}</button>
            ))}
          </div>
        </div>
      </div>

      <div>
        <div className="label">Timing</div>
        <div className="flex gap-1.5">
          {SPEEDS.map((s) => (
            <button key={s.id} onClick={() => setSpeed(s.id)} disabled={running}
              className={`flex-1 rounded-lg px-3 py-2 text-xs font-medium border transition ${
                speed === s.id ? "border-poof-lavender/50 bg-poof-lavender/10 text-poof-lavender" : "border-poof-border text-poof-muted hover:text-poof-text"
              }`}>
              <div>{s.label}</div>
              <div className="text-[10px] opacity-70">{s.min}–{s.max}s</div>
            </button>
          ))}
        </div>
      </div>

      {canDelegate && (
        <label className="flex items-start gap-2.5 rounded-xl border border-poof-border bg-poof-surface/40 p-3 cursor-pointer">
          <input type="checkbox" data-testid="decoy-delegate" checked={delegate} disabled={running}
            onChange={(e) => setDelegate(e.target.checked)} className="mt-0.5 accent-poof-gold" />
          <span className="text-xs text-poof-muted">
            <span className="text-poof-text font-medium">Sign once (delegate)</span> — use a throwaway
            session key so rounds run unattended without a wallet prompt each time. It holds only fee
            dust and is discarded when the run ends.
          </span>
        </label>
      )}

      {progress && (
        <div data-testid="decoy-progress" className={`rounded-xl border p-3 text-xs ${progress.phase === "error" ? "border-poof-danger/40 bg-poof-danger/10 text-poof-danger" : "border-poof-border bg-poof-surface/60 text-poof-muted"}`}>
          <div className="flex items-center gap-2">
            {progress.phase !== "error" && progress.phase !== "done" && <Spinner className="h-3.5 w-3.5" />}
            {phaseText(progress)}
          </div>
        </div>
      )}

      {running ? (
        <button onClick={stop} data-testid="decoy-stop" className="btn-ghost w-full">Stop</button>
      ) : (
        <button onClick={start} data-testid="decoy-start" disabled={balance <= 0n} className="btn-primary w-full">
          Boost privacy
        </button>
      )}
      <p className="text-[11px] text-poof-muted">
        Each round is a real on-chain private transfer to yourself — balance unchanged, footprint blurred. Network fees apply.
      </p>
    </div>
  );
}
