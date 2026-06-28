import { describe, it, expect, vi } from "vitest";
import {
  makeSchedule, isDue, dueSchedules, reschedule, runDue, fireableNow, type ScheduledPayment,
} from "./schedule";

const base = (over: Partial<ScheduledPayment> = {}): ScheduledPayment => ({
  id: "x", toPubkey: "1", toEncPub: "a".repeat(64), label: "Rent",
  currencyId: 0, amountBase: "10000000", intervalSec: 60, nextRun: 1000,
  active: true, createdAt: 0, runs: 0, ...over,
});

describe("schedule logic", () => {
  it("makeSchedule sets first run a delay out", () => {
    const s = makeSchedule({ toPubkey: "1", toEncPub: "a".repeat(64), label: "L", currencyId: 0, amountBase: 5n, intervalSec: 60 }, 0);
    expect(s.nextRun).toBe(60_000);
    expect(s.amountBase).toBe("5");
    expect(s.active).toBe(true);
  });

  it("isDue respects active + time", () => {
    expect(isDue(base({ nextRun: 1000 }), 2000)).toBe(true);
    expect(isDue(base({ nextRun: 3000 }), 2000)).toBe(false);
    expect(isDue(base({ nextRun: 1000, active: false }), 2000)).toBe(false);
  });

  it("reschedule skips missed intervals without a catch-up storm", () => {
    const s = base({ nextRun: 0, intervalSec: 60 });
    // 5 minutes later: should land in the future, exactly one interval ahead
    const r = reschedule(s, 5 * 60 * 1000);
    expect(r.nextRun).toBeGreaterThan(5 * 60 * 1000);
    expect(r.nextRun % 60000).toBe(0);
  });

  it("runDue fires due payments and re-anchors nextRun on completion", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const list = [base({ id: "a", nextRun: 0 }), base({ id: "b", nextRun: 999999 })];
    // inject a fixed completion clock so the next run is timed from when the tx finished
    const { list: out, results } = await runDue(list, send, 1000, { clock: () => 5000 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(0, "1", "a".repeat(64), 10000000n);
    expect(results).toEqual([{ id: "a", label: "Rent", status: "success" }]);
    const a = out.find((s) => s.id === "a")!;
    expect(a.runs).toBe(1);
    expect(a.nextRun).toBe(5000 + 60 * 1000);
    expect(a.lastRun).toBe(5000);
    expect(a.lastStatus).toBe("success");
  });

  it("runDue reports firing start/end for each due schedule", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const list = [base({ id: "a", nextRun: 0 })];
    const phases: Array<[string, string]> = [];
    await runDue(list, send, 1000, { onFire: (id, phase) => phases.push([id, phase]) });
    expect(phases).toEqual([["a", "start"], ["a", "end"]]);
  });

  it("runDue records errors and retries one interval after completion", async () => {
    const send = vi.fn().mockRejectedValue(new Error("nope"));
    const list = [base({ id: "a", nextRun: 0, intervalSec: 60 })];
    const { list: out, results } = await runDue(list, send, 1000, { clock: () => 5000 });
    expect(results[0].status).toBe("error");
    const a = out[0];
    expect(a.lastStatus).toBe("error");
    expect(a.lastError).toContain("nope");
    expect(a.runs).toBe(0);
    expect(a.nextRun).toBe(5000 + 60 * 1000);
  });

  it("dueSchedules filters", () => {
    const list = [base({ id: "a", nextRun: 0 }), base({ id: "b", nextRun: 1e9 }), base({ id: "c", nextRun: 0, active: false })];
    expect(dueSchedules(list, 1000).map((s) => s.id)).toEqual(["a"]);
  });

  it("fireableNow restricts to Demo (1m) cadence while delegated", () => {
    const list = [
      base({ id: "demo", intervalSec: 60 }),
      base({ id: "hourly", intervalSec: 3600 }),
      base({ id: "daily", intervalSec: 86_400 }),
    ];
    // not delegated → everything is eligible
    expect(fireableNow(list, false).map((s) => s.id)).toEqual(["demo", "hourly", "daily"]);
    // delegated → only the Demo cadence may fire; others are deferred
    expect(fireableNow(list, true).map((s) => s.id)).toEqual(["demo"]);
  });
});
