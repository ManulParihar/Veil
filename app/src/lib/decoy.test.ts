import { describe, it, expect, vi } from "vitest";
import { jitterMs, pickDecoyAmount, runDecoyRounds, type DecoyRoundInfo } from "./decoy";

const ADDR = { pubkey: "123", encPub: "a".repeat(64) };

describe("decoy helpers", () => {
  it("jitter stays within bounds", () => {
    for (let i = 0; i < 100; i++) {
      const ms = jitterMs(2, 5);
      expect(ms).toBeGreaterThanOrEqual(2000);
      expect(ms).toBeLessThanOrEqual(5000);
    }
  });

  it("picks a positive sub-balance amount", () => {
    const bal = 100_0000000n;
    for (let i = 0; i < 50; i++) {
      const a = pickDecoyAmount(bal);
      expect(a).toBeGreaterThan(0n);
      expect(a).toBeLessThanOrEqual(bal);
    }
    expect(pickDecoyAmount(0n)).toBe(0n);
  });
});

describe("runDecoyRounds", () => {
  it("runs all rounds and self-sends each time", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const phases: DecoyRoundInfo[] = [];
    const done = await runDecoyRounds({
      rounds: 3, currencyId: 0, minDelaySec: 0, maxDelaySec: 0,
      send, address: ADDR, balanceOf: () => 10_0000000n,
      onRound: (i) => phases.push(i),
    });
    expect(done).toBe(3);
    expect(send).toHaveBeenCalledTimes(3);
    // each call targets our own address
    for (const call of send.mock.calls) {
      expect(call[1]).toBe(ADDR.pubkey);
      expect(call[2]).toBe(ADDR.encPub);
      expect(call[3]).toBeGreaterThan(0n);
    }
    expect(phases.filter((p) => p.phase === "done")).toHaveLength(3);
  });

  it("retries a transient send failure within a round instead of aborting", async () => {
    const send = vi.fn()
      .mockRejectedValueOnce(new Error("tree lag")) // round 1, attempt 1
      .mockResolvedValue(undefined);                // round 1 retry + round 2
    const settleWait = vi.fn().mockResolvedValue(undefined);
    const done = await runDecoyRounds({
      rounds: 2, currencyId: 0, minDelaySec: 0, maxDelaySec: 0,
      send, address: ADDR, balanceOf: () => 10_0000000n,
      settleWait, retryBackoffMs: 0,
    });
    expect(done).toBe(2);
    // round 1: fail then succeed (2 calls); round 2: succeed (1 call)
    expect(send).toHaveBeenCalledTimes(3);
    expect(settleWait).toHaveBeenCalled(); // re-synced before the retry
  });

  it("stops after exhausting per-round retries", async () => {
    const send = vi.fn().mockRejectedValue(new Error("boom"));
    const phases: DecoyRoundInfo[] = [];
    const done = await runDecoyRounds({
      rounds: 5, currencyId: 0, minDelaySec: 0, maxDelaySec: 0,
      send, address: ADDR, balanceOf: () => 10_0000000n,
      onRound: (i) => phases.push(i),
      maxAttemptsPerRound: 2, retryBackoffMs: 0,
    });
    expect(done).toBe(0);
    expect(send).toHaveBeenCalledTimes(2); // 2 attempts on round 1, then stop
    // the failure is surfaced (not silent)
    expect(phases.some((p) => p.phase === "error")).toBe(true);
  });

  it("re-syncs until the leaf count advances before the next round", async () => {
    let leaves = 5;
    // Each settle observes the previous round's commitments landing (leaves grow),
    // so both the between-round settle and the final post-run settle return
    // promptly instead of waiting out the bounded deadline.
    const settleWait = vi.fn().mockImplementation(async () => { leaves += 2; });
    const send = vi.fn().mockResolvedValue(undefined);
    const done = await runDecoyRounds({
      rounds: 2, currencyId: 0, minDelaySec: 0, maxDelaySec: 0,
      send, address: ADDR, balanceOf: () => 10_0000000n,
      settleWait, nextLeafIndex: () => leaves, retryBackoffMs: 0,
    });
    expect(done).toBe(2);
    expect(settleWait).toHaveBeenCalled();
  });

  it("settles once more after the final round (recovers the last self-sent output)", async () => {
    // The final settle runs even though there's no round after it, so the last
    // round's note is trial-decrypted in and the displayed balance doesn't sag.
    let leaves = 5;
    const settleWait = vi.fn().mockImplementation(async () => { leaves += 2; });
    const send = vi.fn().mockResolvedValue(undefined);
    const done = await runDecoyRounds({
      rounds: 1, currencyId: 0, minDelaySec: 0, maxDelaySec: 0,
      send, address: ADDR, balanceOf: () => 10_0000000n,
      settleWait, nextLeafIndex: () => leaves, retryBackoffMs: 0,
    });
    expect(done).toBe(1);
    // A single round has no between-round settle, so any settle call here is the
    // post-run one.
    expect(settleWait).toHaveBeenCalledTimes(1);
  });

  it("stops when there's no balance", async () => {
    const send = vi.fn();
    const done = await runDecoyRounds({
      rounds: 3, currencyId: 0, minDelaySec: 0, maxDelaySec: 0,
      send, address: ADDR, balanceOf: () => 0n,
    });
    expect(done).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("honors an aborted signal before sending", async () => {
    const send = vi.fn();
    const ac = new AbortController();
    ac.abort();
    const done = await runDecoyRounds({
      rounds: 3, currencyId: 0, minDelaySec: 0, maxDelaySec: 0,
      send, address: ADDR, balanceOf: () => 10_0000000n, signal: ac.signal,
    });
    expect(done).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
});
