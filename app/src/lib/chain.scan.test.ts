import { describe, it, expect } from "vitest";
import { scanContractEvents, type EventScanner } from "./chain";

// scanContractEvents doesn't parse events (the caller does), so a fake event is
// just an opaque marker — only its presence/count drives paging/termination.
const ev = (ledger = 0) => ({ ledger, topic: [], value: null });

type Page = { events?: any[]; cursor?: string } | { __error: any };

/** A scripted EventScanner: getHealth returns `oldest` (or throws if it's an
 *  Error); getEvents returns the next page in order (or throws `__error`). */
function fakeScanner(opts: { oldest?: number | Error; pages: Page[] }) {
  let i = 0;
  const calls: any[] = [];
  const scanner: EventScanner = {
    async getHealth() {
      if (opts.oldest instanceof Error) throw opts.oldest;
      return { oldestLedger: opts.oldest };
    },
    async getEvents(req: any) {
      calls.push(req);
      if (i >= opts.pages.length) throw new Error(`unexpected getEvents call #${i + 1} (infinite loop?)`);
      const page = opts.pages[i++];
      if ("__error" in page) throw page.__error;
      return page;
    },
  };
  return { scanner, calls, callCount: () => i };
}

describe("scanContractEvents — retention & paging", () => {
  it("in-range scan: pages until an empty page AFTER data (head)", async () => {
    const { scanner, calls } = fakeScanner({
      oldest: 100, // from=200 > floor → no clamp
      pages: [
        { events: [ev(), ev()], cursor: "c1" },
        { events: [ev()], cursor: "c2" },
        { events: [], cursor: "c3" }, // empty after data ⇒ stop
      ],
    });
    const { events, clamped } = await scanContractEvents(scanner, "C", 200);
    expect(events).toHaveLength(3);
    expect(clamped).toBe(false);
    expect(calls[0].startLedger).toBe(200); // first request used startLedger
    expect(calls[1].cursor).toBe("c1"); // subsequent requests page by cursor
  });

  it("dead-zone: empty pages BEFORE data do not stop the scan (the original bug)", async () => {
    const { scanner, calls, callCount } = fakeScanner({
      oldest: 500, // from=200 < floor → proactive clamp to 501
      pages: [
        { events: [], cursor: "c1" }, // gap between floor and first event…
        { events: [], cursor: "c2" },
        { events: [], cursor: "c3" },
        { events: [ev(), ev()], cursor: "c4" }, // …finally the contract's activity
        { events: [], cursor: "c5" }, // empty after data ⇒ stop
      ],
    });
    const { events, clamped } = await scanContractEvents(scanner, "C", 200);
    expect(events).toHaveLength(2); // NOT 0 — we paged through the dead zone
    expect(clamped).toBe(true);
    expect(callCount()).toBe(5); // didn't bail on the first empty page
    expect(calls[0].startLedger).toBe(501); // clamped into the retained window
  });

  it("reactive clamp: when getHealth is unavailable, parse the floor from the -32600 error and retry", async () => {
    const { scanner, calls } = fakeScanner({
      oldest: new Error("getHealth down"),
      pages: [
        { __error: { code: -32600, message: "startLedger must be within the ledger range: 3188314 - 3309273" } },
        { events: [ev()], cursor: "c1" },
        { events: [], cursor: "c2" },
      ],
    });
    const { events, clamped } = await scanContractEvents(scanner, "C", 200);
    expect(events).toHaveLength(1);
    expect(clamped).toBe(true);
    expect(calls[0].startLedger).toBe(200); // first attempt: original
    expect(calls[1].startLedger).toBe(3188315); // retry: floor + 1
  });

  it("cursor page that hits the tip (range error) ends the scan cleanly, not fatally", async () => {
    // Real RPC behavior: paging to the chain tip rejects the next cursor request
    // with the same "…ledger range…" message instead of returning an empty page.
    // We've already collected everything up to the cursor, so this must NOT throw.
    const { scanner, callCount } = fakeScanner({
      oldest: 100,
      pages: [
        { events: [ev(), ev()], cursor: "c1" }, // page 0 (startLedger)
        { events: [ev()], cursor: "c2" }, // page 1 (cursor) — last real events
        { __error: { code: -32600, message: "startLedger must be within the ledger range: 3192892 - 3313851" } }, // page 2 (cursor) past head
      ],
    });
    const { events, clamped } = await scanContractEvents(scanner, "C", 200);
    expect(events).toHaveLength(3); // kept everything; didn't throw
    expect(clamped).toBe(false);
    expect(callCount()).toBe(3);
  });

  it("stops immediately when a page has no cursor", async () => {
    const { scanner, callCount } = fakeScanner({
      oldest: 100,
      pages: [{ events: [ev(), ev()], cursor: undefined }],
    });
    const { events } = await scanContractEvents(scanner, "C", 200);
    expect(events).toHaveLength(2);
    expect(callCount()).toBe(1);
  });

  it("rethrows a non-retention error (no ledger range to clamp to)", async () => {
    const { scanner } = fakeScanner({
      oldest: 100,
      pages: [{ __error: new Error("network boom") }],
    });
    await expect(scanContractEvents(scanner, "C", 200)).rejects.toThrow("network boom");
  });
});
