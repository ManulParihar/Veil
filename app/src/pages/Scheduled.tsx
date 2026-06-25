import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Play, Pause, Trash2, Plus } from "lucide-react";
import { useWallet } from "../store/wallet";
import { AmountInput, Spinner, useToast } from "../components/ui";
import CurrencySelect from "../components/CurrencySelect";
import { useSchedules } from "../lib/useScheduler";
import { INTERVALS } from "../lib/schedule";
import { parsePaymentLink } from "../lib/paymentLink";
import { currencyById, toBaseUnits, formatAmount, DEFAULT_CURRENCY_ID } from "../lib/currencies";

function countdown(ms: number): string {
  const d = ms - Date.now();
  if (d <= 0) return "due now";
  const s = Math.round(d / 1000);
  if (s < 60) return `in ${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `in ${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `in ${h}h`;
  return `in ${Math.round(h / 24)}d`;
}

export default function Scheduled() {
  const { address, balancesByCurrency } = useWallet();
  const { list, add, remove, toggle, runNow, runningId } = useSchedules();
  const toast = useToast();

  const [to, setTo] = useState("");
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [currencyId, setCurrencyId] = useState(DEFAULT_CURRENCY_ID);
  const [intervalSec, setIntervalSec] = useState(INTERVALS[2].sec); // daily
  const [, force] = useState(0);

  // re-render every second so countdowns tick
  useEffect(() => {
    const iv = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(iv);
  }, []);

  const currency = currencyById(currencyId);
  const parsed = useMemo(() => parsePaymentLink(to), [to]);

  const create = () => {
    if (!parsed) { toast.push("Invalid recipient address or veil: link", "err"); return; }
    const amt = toBaseUnits(amount, currency.decimals);
    if (amt <= 0n) { toast.push("Enter an amount", "err"); return; }
    add({
      toPubkey: parsed.pubkey,
      toEncPub: parsed.encPub,
      label: label.trim() || "Payment",
      currencyId,
      amountBase: amt,
      intervalSec,
    });
    toast.push("Schedule created", "ok");
    setTo(""); setLabel(""); setAmount("");
  };

  if (!address) return null;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-poof-lavender/15 grid place-items-center">
          <CalendarClock className="h-5 w-5 text-poof-lavender" />
        </div>
        <div>
          <h1 className="text-2xl font-bold leading-tight">Scheduled payments</h1>
          <p className="text-xs text-poof-muted">Standing private transfers — proved in your browser, no custodian.</p>
        </div>
      </div>

      {/* create */}
      <div className="card card-glow p-6 space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <div className="label">Asset</div>
            <CurrencySelect value={currencyId} onChange={setCurrencyId} testid="sched-currency" />
          </div>
          <div>
            <div className="label">Label</div>
            <input data-testid="sched-label" className="input text-sm" placeholder="Rent, allowance…" value={label} onChange={(e) => setLabel(e.target.value.slice(0, 40))} />
          </div>
        </div>
        <div>
          <div className="label">Recipient address or veil: link</div>
          <input data-testid="sched-to" className="input mono text-sm" placeholder="pubkey.encpub or veil:…" value={to} onChange={(e) => setTo(e.target.value)} />
          {to && !parsed && <div className="mt-1 text-xs text-poof-danger">Not a valid Veil address.</div>}
          {address && (
            <button onClick={() => setTo(`${address.pubkey}.${address.encPub}`)} className="mt-1 text-xs text-poof-gold hover:underline">Use my own address (test)</button>
          )}
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <div className="label">Amount</div>
            <AmountInput value={amount} onChange={setAmount} unit={currency.symbol} testid="sched-amount" />
          </div>
          <div>
            <div className="label">Every</div>
            <select data-testid="sched-interval" value={intervalSec} onChange={(e) => setIntervalSec(Number(e.target.value))} className="input text-sm">
              {INTERVALS.map((i) => <option key={i.id} value={i.sec}>{i.label}</option>)}
            </select>
          </div>
        </div>
        <button data-testid="sched-create" onClick={create} className="btn-primary w-full">
          <Plus className="h-4 w-4" /> Create schedule
        </button>
      </div>

      {/* list */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-3">
          <div className="font-medium">Your schedules</div>
          <span className="text-xs text-poof-muted">{list.length} total</span>
        </div>
        {list.length === 0 ? (
          <p className="text-sm text-poof-muted">No schedules yet. They fire automatically while the wallet is open.</p>
        ) : (
          <div className="space-y-2.5" data-testid="schedule-list">
            {list.map((s) => {
              const bal = balancesByCurrency[s.currencyId] ?? 0n;
              const amt = (() => { try { return BigInt(s.amountBase); } catch { return 0n; } })();
              const underfunded = amt > bal;
              return (
                <div key={s.id} className={`rounded-xl border p-3.5 ${s.active ? "border-poof-border bg-poof-surface/50" : "border-poof-border/50 bg-poof-surface/20 opacity-70"}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">{s.label}</span>
                        {!s.active && <span className="text-[10px] rounded-full bg-poof-border px-2 py-0.5 text-poof-muted">paused</span>}
                        {s.lastStatus === "error" && <span className="text-[10px] rounded-full bg-poof-danger/15 px-2 py-0.5 text-poof-danger">last failed</span>}
                      </div>
                      <div className="text-xs text-poof-muted mt-0.5 tabular-nums">
                        {formatAmount(amt, s.currencyId)} · {INTERVALS.find((i) => i.sec === s.intervalSec)?.label ?? `${s.intervalSec}s`}
                      </div>
                      <div className="text-[11px] text-poof-muted mt-0.5">
                        {s.active ? `Next ${countdown(s.nextRun)}` : "Paused"} · {s.runs} sent
                        {underfunded && <span className="text-poof-warn"> · underfunded</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button title="Run now" data-testid={`sched-run-${s.id}`} onClick={() => runNow(s.id)} disabled={runningId === s.id}
                        className="h-8 w-8 grid place-items-center rounded-lg border border-poof-border text-poof-gold hover:border-poof-gold transition disabled:opacity-50">
                        {runningId === s.id ? <Spinner className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                      </button>
                      <button title={s.active ? "Pause" : "Resume"} onClick={() => toggle(s.id)}
                        className="h-8 w-8 grid place-items-center rounded-lg border border-poof-border text-poof-muted hover:text-poof-text hover:border-poof-lavender transition">
                        {s.active ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                      </button>
                      <button title="Delete" data-testid={`sched-del-${s.id}`} onClick={() => remove(s.id)}
                        className="h-8 w-8 grid place-items-center rounded-lg border border-poof-border text-poof-muted hover:text-poof-danger hover:border-poof-danger transition">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
