import { describe, expect, it } from "vitest";
import { buildSchedule, makeMergePlan, stepDue, MERGE_MIN_GAP_MS } from "./mergePlan";

describe("merge plan scheduling", () => {
  it("produces one ascending fire-time per step within the window", () => {
    const now = 1_000_000;
    const deadline = now + 60 * 60 * 1000; // 1h
    const sched = buildSchedule(6, now, deadline);
    expect(sched).toHaveLength(6);
    for (let i = 1; i < sched.length; i++) expect(sched[i]).toBeGreaterThan(sched[i - 1]);
    expect(sched[0]).toBeGreaterThan(now);
    // last lands by (or near) the deadline
    expect(sched[sched.length - 1]).toBeLessThanOrEqual(deadline + MERGE_MIN_GAP_MS);
  });

  it("never spaces two merges closer than the settle gap", () => {
    const now = 0;
    const sched = buildSchedule(5, now, now + 5 * 60 * 1000);
    for (let i = 1; i < sched.length; i++) {
      expect(sched[i] - sched[i - 1]).toBeGreaterThanOrEqual(MERGE_MIN_GAP_MS - 1);
    }
  });

  it("stretches a too-short window to fit the minimum spacing", () => {
    const now = 0;
    // deadline only 1s away but 4 merges needed → window must stretch
    const sched = buildSchedule(4, now, now + 1000);
    expect(sched).toHaveLength(4);
    expect(sched[3]).toBeGreaterThanOrEqual(4 * MERGE_MIN_GAP_MS - 1);
  });

  it("empty schedule for zero steps", () => {
    expect(buildSchedule(0, 0, 1000)).toEqual([]);
  });

  it("a fresh plan's first step is due only once its time arrives", () => {
    const now = 1_000_000;
    const plan = makeMergePlan(
      { currencyId: 0, amountBase: 100n, label: "100 X", deadline: now + 3600_000, rounds: 2, totalMerges: 3 },
      now
    );
    expect(plan.fired).toBe(0);
    expect(plan.active).toBe(true);
    expect(stepDue(plan, now)).toBe(false);                 // not yet
    expect(stepDue(plan, plan.schedule[0] + 1)).toBe(true); // due once its time passes
  });
});
