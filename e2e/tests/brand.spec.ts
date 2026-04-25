import { expect, test } from "@playwright/test";
import { signInWithMockGoogle } from "./helpers";

test("brand can create a brand kit and see deposit instructions", async ({ page }) => {
  await signInWithMockGoogle(
    page,
    { email: "brand-owner@example.com", name: "Brand Owner" },
    "/brand/new"
  );

  await page.waitForURL("**/brand/new");
  await expect(page.getByRole("heading", { name: "Create Brand Kit" })).toBeVisible();

  await page.getByLabel("Brand Name *").fill("Nova Reach");
  await page.getByLabel("Tagline").fill("Earned attention, not empty impressions");
  await page
    .getByLabel("Brand Story")
    .fill("Nova Reach helps web3 brands turn curiosity into measurable recall.");
  await page.getByLabel("Prize Pool (USDC) *").fill("50");
  await page.getByLabel("Challenge Duration (hours)").fill("24");

  await page.getByRole("button", { name: "Create Brand Kit & Challenge" }).click();

  await expect(page.getByRole("heading", { name: "Deposit Instructions" })).toBeVisible();
  await expect(page.getByText(/Address:/)).toBeVisible();
  await expect(page.getByText(/Memo:/)).toBeVisible();
});
