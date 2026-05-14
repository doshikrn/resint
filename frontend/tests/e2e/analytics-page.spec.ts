import { expect, test } from "@playwright/test";

import { prepareInventoryRevisionPage, runPreflight } from "./helpers/inventory-e2e";

let preflightSkipReason: string | null = null;

test.describe("Inventory analytics page", () => {
  test.beforeAll(async ({ request }) => {
    preflightSkipReason = await runPreflight(request);
  });

  test.beforeEach(async () => {
    test.skip(Boolean(preflightSkipReason), `Preflight failed: ${preflightSkipReason}`);
  });

  test("loads analytics: KPI or access denied", async ({ page }) => {
    await prepareInventoryRevisionPage(page);
    await page.goto("/analytics");
    await expect(page.getByTestId("analytics-page-root")).toBeVisible({ timeout: 20_000 });
    const denied = page.getByTestId("analytics-access-denied");
    const kpi = page.getByTestId("analytics-kpi-sessions");
    await expect(denied.or(kpi)).toBeVisible({ timeout: 15_000 });
    if (await kpi.isVisible()) {
      await expect(page.getByTestId("analytics-warehouse-select")).toBeVisible();
    }
  });
});
