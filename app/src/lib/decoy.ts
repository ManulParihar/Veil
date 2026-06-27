// Decoy / timing defenses — automated self-transfers that fatten the anonymity
// set and sever timing correlations.
//
// A self-transfer spends your notes and re-emits fresh commitments to yourself:
// the chain sees new joinsplits with new nullifiers and new output commitments,
// indistinguishable from real payments, while your balance is unchanged. Doing a
// few of these on a RANDOMIZED schedule:
//   • adds commitments to the pool (everyone's anonymity set grows), and
//   • moves your notes to fresh leaves with deposits between them and their
//     origin, breaking the "deposited then immediately spent" timing tell.
//
// This module is pure orchestration over the wallet's existing `send` — no new
// crypto, no circuit changes.

export interface SelfAddress {
  pubkey: string;
  encPub: string;
}

export type DecoyPhase = "waiting" | "sending" | "done" | "error";

export interface DecoyRoundInfo {
  round: number;
  total: number;
  amount: bigint;
  /** Asset being remixed — carried here so progress renders with the right
   *  symbol/decimals even after the form is remounted on navigation. */
  currencyId: number;
  phase: DecoyPhase;
  error?: string;
}

export interface DecoyOptions {
  rounds: number;
  currencyId: number;
  minDelaySec: number;
  maxDelaySec: number;
  /** the wallet's send(); a self-transfer when given our own address. */
  send: (currencyId: number, pubkey: string, encPub: string, amount: bigint) => Promise<unknown>;
  /** our own shielded address (the decoy destination). */
  address: SelfAddress;
  /** read the *current* spendable balance fresh each round (it changes as notes settle). */
  balanceOf: () => bigint;
  onRound?: (info: DecoyRoundInfo) => void;
  signal?: AbortSignal;
  /** Re-sync local state with the chain (rebuild the mirror tree from RPC).
   *  Called between rounds so the next spend sees the previous round's freshly
   *  settled note, and again before retrying a transient pre-flight failure. */
  settleWait?: () => Promise<unknown>;
  /** Current next-leaf index — used to detect when a round's commitments have
   *  actually been indexed on-chain before the next spend. */
  nextLeafIndex?: () => number | null;
  /** Max attempts per round before giving up (default 3). A round that fails for
   *  a transient reason (RPC tree lag) is re-synced and retried instead of
   *  aborting the whole run on the first hiccup. */
  maxAttemptsPerRound?: number;
  /** Backoff (ms) between retry attempts within a round (default 1500). */
  retryBackoffMs?: number;
  /** Bound (ms) on waiting for the previous round to settle (default 8000). */
  settleTimeoutMs?: number;
}

/** Uniform random delay in ms within [minSec, maxSec]. */
export function jitterMs(minSec: number, maxSec: number): number {
  const lo = Math.min(minSec, maxSec);
  const hi = Math.max(minSec, maxSec);
  return Math.round((lo + Math.random() * (hi - lo)) * 1000);
}

/** A random, non-round-looking portion of the balance to self-send (10–89%). */
export function pickDecoyAmount(balance: bigint): bigint {
  if (balance <= 0n) return 0n;
  const pct = 10 + Math.floor(Math.random() * 80); // 10..89
  const amt = (balance * BigInt(pct)) / 100n;
  return amt > 0n ? amt : balance;
}

/** setTimeout that resolves early (and cleanly) if the signal aborts. */
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => { clearTimeout(t); resolve(); };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Run `rounds` decoy self-transfers with randomized gaps. Returns how many
 * completed. Each round reads the balance fresh, so a stale snapshot can't
 * over-spend.
 *
 * Reliability (see Fix 2): rapid rounds spend a change note the RPC may not have
 * indexed yet, which throws pre-flight. So between rounds we `settleWait` (re-sync)
 * until the leaf count actually advances past the previous round (bounded), and a
 * round that fails for such a transient reason is re-synced and RETRIED rather
 * than aborting the whole run on the first hiccup. Only after exhausting the
 * per-round attempts (or on abort / no balance) do we stop.
 */
export async function runDecoyRounds(opts: DecoyOptions): Promise<number> {
  let completed = 0;
  const maxAttempts = Math.max(1, opts.maxAttemptsPerRound ?? 3);
  const backoffMs = opts.retryBackoffMs ?? 1500;
  // Leaf count we expect the tree to grow beyond before the next spend. Captured
  // pre-send each round (the store's nextLeafIndex still reflects the pre-send
  // tree right after send returns), so the next round can detect settlement.
  let settleBaseline = opts.nextLeafIndex?.() ?? null;

  for (let round = 1; round <= opts.rounds; round++) {
    if (opts.signal?.aborted) break;

    const delay = jitterMs(opts.minDelaySec, opts.maxDelaySec);
    opts.onRound?.({ round, total: opts.rounds, currencyId: opts.currencyId, amount: 0n, phase: "waiting" });
    await abortableSleep(delay, opts.signal);
    if (opts.signal?.aborted) break;

    // Settle the previous round before spending again (skipped on the first
    // round — nothing of ours is pending yet).
    if (round > 1) {
      await settleUntilAdvanced(opts, settleBaseline);
      if (opts.signal?.aborted) break;
    }

    const balance = opts.balanceOf();
    const amount = pickDecoyAmount(balance);
    if (amount <= 0n) {
      opts.onRound?.({ round, total: opts.rounds, currencyId: opts.currencyId, amount: 0n, phase: "error", error: "no spendable balance" });
      break;
    }

    let sent = false;
    let lastErr = "";
    for (let attempt = 1; attempt <= maxAttempts && !sent; attempt++) {
      if (opts.signal?.aborted) break;
      // Record the pre-send leaf count as the next round's settlement baseline.
      settleBaseline = opts.nextLeafIndex?.() ?? settleBaseline;
      opts.onRound?.({ round, total: opts.rounds, currencyId: opts.currencyId, amount, phase: "sending" });
      try {
        await opts.send(opts.currencyId, opts.address.pubkey, opts.address.encPub, amount);
        sent = true;
        completed++;
        opts.onRound?.({ round, total: opts.rounds, currencyId: opts.currencyId, amount, phase: "done" });
      } catch (e: any) {
        lastErr = String(e?.message ?? e);
        // Transient pre-flight failures (tree lag) clear after a re-sync. Wait,
        // re-sync, and retry rather than aborting the whole run.
        if (attempt < maxAttempts && !opts.signal?.aborted) {
          opts.onRound?.({ round, total: opts.rounds, currencyId: opts.currencyId, amount, phase: "waiting", error: lastErr });
          await opts.settleWait?.();
          await abortableSleep(backoffMs, opts.signal);
        }
      }
    }
    if (!sent) {
      // Exhausted retries (or aborted mid-retry): surface the failure and stop so
      // we don't spin on a genuinely broken chain. The errored round stays
      // visible in the last onRound emission.
      if (!opts.signal?.aborted) {
        opts.onRound?.({ round, total: opts.rounds, currencyId: opts.currencyId, amount, phase: "error", error: lastErr || "send failed" });
      }
      break;
    }
  }
  return completed;
}

/** Re-sync (bounded) until the on-chain leaf count advances past `baseline`, so
 *  the next spend sees a complete tree. No-op without settle hooks. */
async function settleUntilAdvanced(opts: DecoyOptions, baseline: number | null): Promise<void> {
  if (!opts.settleWait) return;
  const deadline = Date.now() + (opts.settleTimeoutMs ?? 8000);
  for (;;) {
    if (opts.signal?.aborted) return;
    await opts.settleWait();
    const cur = opts.nextLeafIndex?.() ?? null;
    // Without a leaf signal we can only sync once; with one, wait for growth.
    if (baseline == null || cur == null || cur > baseline) return;
    if (Date.now() >= deadline) return;
    await abortableSleep(800, opts.signal);
  }
}
