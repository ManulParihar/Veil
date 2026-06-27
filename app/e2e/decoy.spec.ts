import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";

const SHOTS = "e2e/screenshots";
mkdirSync(SHOTS, { recursive: true });

// Live verification that the RPC-retention "startLedger must be within the ledger
// range" error no longer triggers during a decoy run. Real browser, real testnet:
// create → fund → DEPOSIT 2 XLM → run the Decoy booster (Demo timing, 3 rounds of
// real on-chain private self-transfers). Each round calls syncChain →
// getNewCommitments (the hardened scan); we assert no round and no console error
// ever shows the ledger-range message, the run completes, and balance is unchanged.
test("decoy booster runs without the RPC ledger-range error (on-chain)", async ({ page }) => {
  test.setTimeout(600_000);

  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  await page.goto("/app");
  await expect(page.getByTestId("create-btn")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("create-btn").click();
  await expect(page.getByTestId("seed-display")).toBeVisible({ timeout: 30_000 });

  await page.getByTestId("fund-btn").click();
  await expect(page.getByTestId("balance")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("balance")).toContainText("0", { timeout: 30_000 });

  // ── DEPOSIT 2 XLM so there's shielded balance to remix ──
  await page.goto("/app/deposit");
  await page.getByTestId("deposit-amount").fill("2");
  await page.getByTestId("deposit-submit").click();
  await expect(page.getByTestId("tx-progress")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("tx-status")).toContainText("confirmed", { timeout: 150_000 });
  await page.goto("/app");
  await expect(page.getByTestId("balance")).toContainText("2", { timeout: 30_000 });

  // ── DECOY BOOSTER: 3 rounds, Demo timing (defaults), XLM ──
  await page.goto("/app/privacy");
  await expect(page.getByTestId("decoy-booster")).toBeVisible({ timeout: 30_000 });
  const startBtn = page.getByTestId("decoy-start");
  await expect(startBtn).toBeEnabled({ timeout: 60_000 }); // enabled once balance synced
  await startBtn.click();

  // The run lifts into the store; progress appears, Stop replaces Start.
  await expect(page.getByTestId("decoy-progress")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("decoy-stop")).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: `${SHOTS}/decoy-01-running.png`, fullPage: true });

  // Fail fast if any round surfaces the ledger-range error while running.
  const RANGE_RE = /ledger range/i;
  for (let i = 0; i < 120; i++) {
    if (await page.getByTestId("decoy-start").isVisible().catch(() => false)) break; // run finished
    const txt = (await page.getByTestId("decoy-progress").textContent().catch(() => "")) || "";
    expect(txt, "decoy progress must never show the RPC ledger-range error").not.toMatch(RANGE_RE);
    await page.waitForTimeout(2_000);
  }

  // Run finished: Start button is back.
  await expect(page.getByTestId("decoy-start")).toBeVisible({ timeout: 300_000 });
  const finalProgress = (await page.getByTestId("decoy-progress").textContent().catch(() => "")) || "";
  await page.screenshot({ path: `${SHOTS}/decoy-02-finished.png`, fullPage: true });
  console.log("DECOY_FINAL_PROGRESS:", finalProgress.replace(/\s+/g, " ").trim());

  // The last round must be a success ("done"), not an error of any kind.
  expect(finalProgress).not.toMatch(RANGE_RE);
  expect(finalProgress.toLowerCase()).toContain("done");

  // Decoy self-transfers conserve value on-chain, but syncChain only validates
  // existing notes — it doesn't trial-decrypt to discover NEW incoming notes, so
  // the just-self-sent outputs surface only after a scan. Run one (it exercises
  // the hardened scan again) and confirm the FULL balance is restored, proving the
  // scan is complete and no value was lost.
  await page.goto("/app/receive");
  await page.getByTestId("scan-btn").click();
  await expect(page.getByTestId("scan-btn")).toBeDisabled({ timeout: 10_000 }).catch(() => {});
  await expect(page.getByTestId("scan-btn")).toBeEnabled({ timeout: 120_000 });
  await page.goto("/app");
  await expect(page.getByTestId("balance")).toContainText("2", { timeout: 30_000 });

  // No ledger-range error ever hit the console; ignore benign 404/favicon/React.
  expect(errors.filter((e) => RANGE_RE.test(e)), "no ledger-range error in console").toEqual([]);
  expect(
    errors.filter((e) => !/favicon|Download the React|Failed to load resource.*404/i.test(e)),
  ).toEqual([]);
});
