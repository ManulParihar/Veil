import { describe, it, expect } from "vitest";
import { assessSpend, depositsAfter, setSizeLevel, freshnessLevel } from "./anonymitySet";
import type { StoredNote } from "./types";

const note = (leafIndex: number | null, currencyId = 0, extra: Partial<StoredNote> = {}): StoredNote => ({
  note: { amount: 1_0000000n, currencyId, pubkey: 1n, blinding: 2n },
  leafIndex, spent: false, createdAt: 0, ...extra,
});

describe("anonymitySet", () => {
  it("levels set size", () => {
    expect(setSizeLevel(5)).toBe("danger");
    expect(setSizeLevel(30)).toBe("warn");
    expect(setSizeLevel(100)).toBe("good");
    expect(setSizeLevel(500)).toBe("strong");
  });

  it("counts deposits after a leaf", () => {
    expect(depositsAfter(10, 20)).toBe(9);
    expect(depositsAfter(19, 20)).toBe(0);
    expect(depositsAfter(25, 20)).toBe(0); // never negative
  });

  it("levels freshness", () => {
    expect(freshnessLevel(0)).toBe("danger");
    expect(freshnessLevel(4)).toBe("warn");
    expect(freshnessLevel(20)).toBe("good");
    expect(freshnessLevel(100)).toBe("strong");
  });

  it("overall is the weaker of set size and freshness", () => {
    // big pool but freshly deposited note → freshness dominates
    const a = assessSpend([note(199)], 0, 200);
    expect(a.setLevel).toBe("strong");
    expect(a.freshest).toBe(0);
    expect(a.overall).toBe("danger");
    expect(a.message).toMatch(/just deposited/i);
  });

  it("ignores spent / wrong-currency / unplaced notes", () => {
    const candidates = [
      note(5, 0, { spent: true }),
      note(5, 1),
      note(null, 0),
      note(2, 0),
    ];
    const a = assessSpend(candidates, 0, 100);
    expect(a.freshest).toBe(depositsAfter(2, 100));
  });

  it("handles no candidates", () => {
    const a = assessSpend([], 0, 100);
    expect(a.freshest).toBeNull();
    expect(a.overall).toBe(a.setLevel);
  });

  it("handles empty pool", () => {
    const a = assessSpend([], 0, 0);
    expect(a.setSize).toBe(0);
    expect(a.setLevel).toBe("danger");
  });
});
