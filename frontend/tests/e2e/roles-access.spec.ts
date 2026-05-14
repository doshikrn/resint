import { expect, test, type APIRequestContext } from "@playwright/test";

import {
  apiGetMe,
  ensureActiveInventorySession,
  loginAs,
  loginWithEnv,
  prepareInventoryRevisionPage,
  resolveWarehouseId,
  runPreflight,
} from "./helpers/inventory-e2e";

let preflightSkipReason: string | null = null;

async function createCookUser(request: APIRequestContext, warehouseId: number, suffix: string) {
  const username = `e2e-cook-role-${suffix}`.slice(0, 48);
  const password = `Pass-${suffix}-123!`;
  const response = await request.post("/api/backend/users", {
    data: {
      username,
      password,
      full_name: `E2E Cook ${suffix}`,
      role: "cook",
      warehouse_id: warehouseId,
    },
  });
  return { response, username, password };
}

test.describe("Roles and restricted routes", () => {
  test.beforeAll(async ({ request }) => {
    preflightSkipReason = await runPreflight(request);
  });

  test.beforeEach(async () => {
    test.skip(Boolean(preflightSkipReason), `Preflight failed: ${preflightSkipReason}`);
  });

  test("manager reaches /users; cook gets users + backups denial", async ({ page }) => {
    const suffix = `${test.info().project.name}-${Date.now()}`.replace(/[^a-z0-9-]/gi, "-").toLowerCase();

    await prepareInventoryRevisionPage(page);
    await page.goto("/users");
    if (await page.getByTestId("users-access-denied").isVisible().catch(() => false)) {
      test.skip(true, "E2E user cannot access /users (needs manager or equivalent)");
    }
    await expect(page.getByRole("heading", { name: "Пользователи" })).toBeVisible({ timeout: 15_000 });

    const me = await apiGetMe(page.request);
    const warehouseId = resolveWarehouseId(me);
    const cook = await createCookUser(page.request, warehouseId, suffix);
    if (cook.response.status() === 403) {
      test.skip(true, "E2E user cannot create cook");
    }
    expect(cook.response.status()).toBe(201);

    await page.evaluate(async () => {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include", cache: "no-store" });
    });
    await loginAs(page, cook.username, cook.password);

    await page.goto("/users");
    await expect(page.getByTestId("users-access-denied")).toBeVisible({ timeout: 15_000 });

    await page.goto("/backups");
    await expect(page.getByTestId("backups-access-error")).toBeVisible({ timeout: 15_000 });
  });
});
