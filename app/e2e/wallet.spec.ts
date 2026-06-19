import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";

const SHOTS = "e2e/screenshots";
mkdirSync(SHOTS, { recursive: true });

// Full real path: create identity → fund fee account (friendbot) → deposit
// (REAL in-browser Groth16 proof + REAL on-chain transact) → balance updates.
test("create → fund → deposit (real proof + on-chain)", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  await page.goto("/");
  // redirected to onboarding
  await expect(page.getByTestId("create-btn")).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: `${SHOTS}/01-welcome.png`, fullPage: true });

  // create identity
  await page.getByTestId("create-btn").click();
  await expect(page.getByTestId("seed-display")).toBeVisible({ timeout: 30_000 });
  const seed = (await page.getByTestId("seed-display").textContent())!.trim();
  expect(seed).toMatch(/^[0-9a-f]{64}$/);
  await page.screenshot({ path: `${SHOTS}/02-seed.png`, fullPage: true });

  // fund fee account via friendbot (real network)
  await page.getByTestId("fund-btn").click();
  // after funding we navigate to the dashboard
  await expect(page.getByTestId("balance")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("balance")).toContainText("0");
  await page.screenshot({ path: `${SHOTS}/03-dashboard.png`, fullPage: true });

  // deposit 100 VEIL — real proof + real on-chain transact
  await page.goto("/deposit");
  await page.getByTestId("deposit-amount").fill("100");
  await page.screenshot({ path: `${SHOTS}/04-deposit-form.png`, fullPage: true });
  await page.getByTestId("deposit-submit").click();

  // progress stepper appears and reaches confirmed
  await expect(page.getByTestId("tx-progress")).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: `${SHOTS}/05-proving.png`, fullPage: true });
  await expect(page.getByTestId("tx-status")).toContainText("confirmed", { timeout: 150_000 });
  await expect(page.getByTestId("tx-hash")).toBeVisible();
  const hash = (await page.getByTestId("tx-hash").textContent()) || "";
  await page.screenshot({ path: `${SHOTS}/06-confirmed.png`, fullPage: true });

  // balance reflects the deposit
  await page.goto("/");
  await expect(page.getByTestId("balance")).toContainText("100", { timeout: 30_000 });
  await page.screenshot({ path: `${SHOTS}/07-balance-100.png`, fullPage: true });

  console.log("DEPOSIT_TX:", hash.replace(/\s+/g, " ").trim());
  expect(errors.filter((e) => !/favicon|Download the React/i.test(e))).toEqual([]);
});
