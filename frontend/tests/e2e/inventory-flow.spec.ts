import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import {
  RECENT_PENDING_RE,
  RECENT_SAVED_RE,
  clickSaveEntry,
  ensureActiveInventorySession,
  ensureInventoryItem,
  loginAs,
  loginWithEnv,
  prepareInventoryRevisionPage,
  resumeInventoryRevisionPage,
  runPreflight,
  selectInventoryItemBySearch,
} from "./helpers/inventory-e2e";

let preflightSkipReason: string | null = null;

async function logout(page: Page) {
  await page.evaluate(async () => {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
      cache: "no-store",
    });
  });
  await page.goto("/login");
  await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
}

function buildSuffix(projectName: string) {
  return `${projectName}-${Date.now()}`.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
}

async function createSecondaryUser(request: APIRequestContext, warehouseId: number, suffix: string) {
  const username = `e2e-cook-${suffix}`.slice(0, 48);
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

test.describe("Inventory revision critical flow", () => {
  test.beforeAll(async ({ request }) => {
    preflightSkipReason = await runPreflight(request);
  });

  test.beforeEach(async () => {
    test.skip(Boolean(preflightSkipReason), `Preflight failed: ${preflightSkipReason}`);
  });

  test("login -> inventory -> search/select -> save -> recent visible", async ({ page }) => {
    const suffix = buildSuffix(test.info().project.name);
    const { warehouseId } = await prepareInventoryRevisionPage(page);
    const item = await ensureInventoryItem(page.request, warehouseId, `E2E Item ${suffix}`);

    await selectInventoryItemBySearch(page, item.name);
    await page.getByTestId("inventory-qty-input").fill("3");
    await clickSaveEntry(page);

    const recentBlock = page.getByTestId("inventory-recent-block");
    await expect(recentBlock).toContainText(item.name, { timeout: 20_000 });
    await expect(recentBlock).toContainText(RECENT_SAVED_RE, { timeout: 20_000 });
  });

  test("offline enqueue -> reload -> relogin keeps pending visible", async ({ page, context }) => {
    const suffix = buildSuffix(test.info().project.name);
    const { warehouseId } = await prepareInventoryRevisionPage(page);
    const item = await ensureInventoryItem(page.request, warehouseId, `E2E Item ${suffix}`);
    const pendingItem = await ensureInventoryItem(page.request, warehouseId, `E2E Pending ${suffix}`);

    const session = await ensureActiveInventorySession(page.request, warehouseId);
    for (let quantity = 1; quantity <= 24; quantity += 1) {
      const response = await page.request.post(`/api/backend/inventory/sessions/${session.id}/entries`, {
        data: { item_id: item.id, quantity, mode: "set" },
      });
      expect(response.ok()).toBeTruthy();
    }

    await selectInventoryItemBySearch(page, pendingItem.name);
    await context.setOffline(true);
    await page.getByTestId("inventory-qty-input").fill("4");
    await clickSaveEntry(page);

    const recentBlock = page.getByTestId("inventory-recent-block");
    await expect(recentBlock).toContainText(pendingItem.name, { timeout: 20_000 });
    await expect(recentBlock).toContainText(RECENT_PENDING_RE, { timeout: 20_000 });

    await context.route("**/api/backend/health**", async (route) => {
      await route.abort();
    });
    await context.setOffline(false);

    await resumeInventoryRevisionPage(page);
    await expect(page.getByTestId("inventory-recent-block")).toContainText(pendingItem.name, {
      timeout: 20_000,
    });
    await expect(page.getByTestId("inventory-recent-block")).toContainText(RECENT_PENDING_RE, {
      timeout: 20_000,
    });

    await logout(page);
    await loginWithEnv(page);
    await resumeInventoryRevisionPage(page);
    await expect(page.getByTestId("inventory-recent-block")).toContainText(pendingItem.name, {
      timeout: 20_000,
    });
    await expect(page.getByTestId("inventory-recent-block")).toContainText(RECENT_PENDING_RE, {
      timeout: 20_000,
    });
  });

  test("save updates progress without manual reload", async ({ page }) => {
    const suffix = buildSuffix(test.info().project.name);
    const { warehouseId } = await prepareInventoryRevisionPage(page);
    const item = await ensureInventoryItem(page.request, warehouseId, `E2E Item ${suffix}`);

    await selectInventoryItemBySearch(page, item.name);
    await page.getByTestId("inventory-qty-input").fill("3");
    await clickSaveEntry(page);

    const recentBlock = page.getByTestId("inventory-recent-block");
    await expect(recentBlock).toContainText(item.name, { timeout: 20_000 });
    await expect(recentBlock).toContainText(RECENT_SAVED_RE, { timeout: 20_000 });
    await expect
      .poll(async () => Number.parseInt(await page.getByTestId("inventory-progress-total").innerText(), 10), {
        timeout: 20_000,
      })
      .toBe(1);
    await expect
      .poll(async () => Number.parseInt(await page.getByTestId("inventory-progress-mine").innerText(), 10), {
        timeout: 20_000,
      })
      .toBe(1);
    await expect(page.getByTestId("inventory-progress-last-change")).not.toContainText("—", {
      timeout: 15_000,
    });
  });

  test("relogin restores inventory bootstrap and reload keeps auth", async ({ page }) => {
    const suffix = buildSuffix(test.info().project.name);
    const { warehouseId } = await prepareInventoryRevisionPage(page);
    const item = await ensureInventoryItem(page.request, warehouseId, `E2E Item ${suffix}`);

    await selectInventoryItemBySearch(page, item.name);
    await page.getByTestId("inventory-qty-input").fill("5");
    await clickSaveEntry(page);

    const recentBlock = page.getByTestId("inventory-recent-block");
    await expect(recentBlock).toContainText(item.name, { timeout: 20_000 });
    await expect(recentBlock).toContainText(RECENT_SAVED_RE, { timeout: 20_000 });

    await logout(page);
    await loginWithEnv(page);

    await resumeInventoryRevisionPage(page);
    await expect(page.getByTestId("inventory-recent-block")).toContainText(item.name, { timeout: 20_000 });

    await page.reload();
    await expect(page).toHaveURL(/\/inventory/, { timeout: 20_000 });
    await expect(page.getByTestId("inventory-progress-card")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("inventory-recent-block")).toContainText(item.name, { timeout: 20_000 });
    await expect(page.getByTestId("login-submit")).toHaveCount(0);
  });

  test("my/all toggle persists after reload and does not hide valid entries", async ({ page }) => {
    const suffix = buildSuffix(test.info().project.name);
    const { warehouseId } = await prepareInventoryRevisionPage(page);
    const remoteItem = await ensureInventoryItem(page.request, warehouseId, `E2E Remote ${suffix}`);

    const secondary = await createSecondaryUser(page.request, warehouseId, suffix);
    if (secondary.response.status() === 403) {
      test.skip(true, "E2E user cannot create a secondary warehouse user");
    }
    expect(secondary.response.status()).toBe(201);

    await logout(page);
    await loginAs(page, secondary.username, secondary.password);
    await resumeInventoryRevisionPage(page);
    await selectInventoryItemBySearch(page, remoteItem.name);
    await page.getByTestId("inventory-qty-input").fill("2");
    await clickSaveEntry(page);
    await expect(page.getByTestId("inventory-recent-block")).toContainText(remoteItem.name, { timeout: 20_000 });

    await logout(page);
    await loginWithEnv(page);
    await resumeInventoryRevisionPage(page);

    const recentBlock = page.getByTestId("inventory-recent-block");
    await expect(recentBlock).toContainText(remoteItem.name, { timeout: 20_000 });

    await page.getByTestId("inventory-recent-filter-mine").click();
    await expect(recentBlock).not.toContainText(remoteItem.name, { timeout: 12_000 });

    await page.getByTestId("inventory-recent-filter-all").click();
    await expect(recentBlock).toContainText(remoteItem.name, { timeout: 12_000 });

    await resumeInventoryRevisionPage(page);
    await expect(page.getByTestId("inventory-recent-block")).toContainText(remoteItem.name, { timeout: 20_000 });
  });

  test("reconnect and sync do not clear recent entries", async ({ page, context }) => {
    const suffix = buildSuffix(test.info().project.name);
    const { warehouseId } = await prepareInventoryRevisionPage(page);
    const item = await ensureInventoryItem(page.request, warehouseId, `E2E Item ${suffix}`);

    await selectInventoryItemBySearch(page, item.name);
    await context.setOffline(true);
    await page.getByTestId("inventory-qty-input").fill("4");
    await clickSaveEntry(page);

    const recentBlock = page.getByTestId("inventory-recent-block");
    await expect(recentBlock).toContainText(item.name, { timeout: 20_000 });
    await expect(recentBlock).toContainText(RECENT_PENDING_RE, { timeout: 20_000 });

    await context.setOffline(false);
    await expect
      .poll(async () => (await recentBlock.innerText()).toLowerCase(), { timeout: 45_000 })
      .toMatch(RECENT_SAVED_RE);

    await page.evaluate(() => {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("online"));
    });

    await expect(recentBlock).toContainText(item.name, { timeout: 20_000 });
    await expect
      .poll(async () => (await recentBlock.innerText()).toLowerCase(), { timeout: 30_000 })
      .toMatch(RECENT_SAVED_RE);
  });

  test("export XLSX download (reports tab, active session)", async ({ page }) => {
    const suffix = buildSuffix(test.info().project.name);
    const { warehouseId } = await prepareInventoryRevisionPage(page);

    const pfItem = await ensureInventoryItem(page.request, warehouseId, `E2E п/ф ${suffix}`);
    const session = await ensureActiveInventorySession(page.request, warehouseId);
    const entryRes = await page.request.post(`/api/backend/inventory/sessions/${session.id}/entries`, {
      data: { item_id: pfItem.id, quantity: 1, mode: "set" },
    });
    expect(entryRes.ok()).toBeTruthy();

    await page.getByTestId("inventory-tab-reports").click();
    await expect(page.getByTestId("inventory-export-xlsx-btn").first()).toBeVisible({ timeout: 20_000 });

    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("inventory-export-xlsx-btn").first().click();
    const download = await downloadPromise;
    const name = download.suggestedFilename().toLowerCase();
    expect(name).toMatch(/\.xlsx$/);

    const path = await download.path();
    expect(path).toBeTruthy();
    const fs = await import("node:fs/promises");
    const buf = await fs.readFile(path!);
    const semifinishedTitle = Buffer.from("п\u2044ф", "utf8");
    expect(buf.includes(semifinishedTitle)).toBeTruthy();
  });

  test("export CSV contains item name (API, same session as UI)", async ({ page }) => {
    const suffix = buildSuffix(test.info().project.name);
    const { warehouseId } = await prepareInventoryRevisionPage(page);
    const item = await ensureInventoryItem(page.request, warehouseId, `E2E CSV ${suffix}`);
    const session = await ensureActiveInventorySession(page.request, warehouseId);
    const post = await page.request.post(`/api/backend/inventory/sessions/${session.id}/entries`, {
      data: { item_id: item.id, quantity: 2, mode: "set" },
    });
    expect(post.ok()).toBeTruthy();

    const r = await page.request.get(`/api/backend/inventory/sessions/${session.id}/export?format=csv`);
    expect(r.ok()).toBeTruthy();
    const text = await r.text();
    expect(text).toContain(item.name);
  });

  test("API: PATCH entry after close requires reason", async ({ page }) => {
    const suffix = buildSuffix(test.info().project.name);
    const { warehouseId } = await prepareInventoryRevisionPage(page);
    const item = await ensureInventoryItem(page.request, warehouseId, `E2E PatchClose ${suffix}`);
    const session = await ensureActiveInventorySession(page.request, warehouseId);
    const post = await page.request.post(`/api/backend/inventory/sessions/${session.id}/entries`, {
      data: { item_id: item.id, quantity: 3, mode: "set" },
    });
    expect(post.ok()).toBeTruthy();
    const entry = (await post.json()) as { version: number };
    const closeResponse = await page.request.post(`/api/backend/inventory/sessions/${session.id}/close`, {
      data: { reason: "e2e-close" },
    });
    expect(closeResponse.ok()).toBeTruthy();

    const badPatch = await page.request.patch(
      `/api/backend/inventory/sessions/${session.id}/entries/${item.id}`,
      { data: { quantity: 4, version: entry.version } },
    );
    expect(badPatch.status()).toBe(422);

    const okPatch = await page.request.patch(`/api/backend/inventory/sessions/${session.id}/entries/${item.id}`, {
      data: { quantity: 4, version: entry.version, reason: "e2e-correction" },
    });
    expect(okPatch.ok()).toBeTruthy();
  });

  test("closed session blocks further saves in UI", async ({ page }) => {
    const suffix = buildSuffix(test.info().project.name);
    const { warehouseId } = await prepareInventoryRevisionPage(page);
    const item = await ensureInventoryItem(page.request, warehouseId, `E2E Item ${suffix}`);

    await selectInventoryItemBySearch(page, item.name);
    await page.getByTestId("inventory-qty-input").fill("2");

    const session = await ensureActiveInventorySession(page.request, warehouseId);
    const closeResponse = await page.request.post(`/api/backend/inventory/sessions/${session.id}/close`, {
      data: { reason: "e2e-close" },
    });
    expect(closeResponse.ok()).toBeTruthy();

    await expect(page.getByText(/Ввод заблокирован|Сессия закрыта/)).toBeVisible({ timeout: 20_000 });
    await clickSaveEntry(page);
    await expect(page.getByText(/Ревизия завершена|Сессия закрыта/)).toBeVisible({ timeout: 25_000 });
  });

  test("keyboard: search + Enter selects first row -> qty comma -> save -> focus search", async ({ page }) => {
    const suffix = buildSuffix(test.info().project.name);
    const { warehouseId } = await prepareInventoryRevisionPage(page);
    const item = await ensureInventoryItem(page.request, warehouseId, `E2E Keyboard ${suffix}`, "kg");

    const search = page.getByTestId("inventory-search-input");
    await search.fill(item.name);
    await expect(page.getByTestId("inventory-search-dropdown").locator("button").first()).toBeVisible({
      timeout: 15_000,
    });
    await search.press("Enter");
    await expect(page.getByTestId("inventory-qty-input")).toBeFocused({ timeout: 10_000 });

    await page.getByTestId("inventory-qty-input").fill("1,25");
    await clickSaveEntry(page);

    const recentBlock = page.getByTestId("inventory-recent-block");
    await expect(recentBlock).toContainText(item.name, { timeout: 20_000 });
    await expect(recentBlock).toContainText(RECENT_SAVED_RE, { timeout: 20_000 });
    await expect(search).toBeFocused({ timeout: 15_000 });
  });

  test("many sequential saves keep single recent row per item (chromium only)", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Stress run on chromium only");
    test.slow();

    const suffix = buildSuffix(testInfo.project.name);
    const { warehouseId } = await prepareInventoryRevisionPage(page);
    const item = await ensureInventoryItem(page.request, warehouseId, `E2E Stress ${suffix}`);

    await selectInventoryItemBySearch(page, item.name);
    for (let i = 1; i <= 105; i += 1) {
      await page.getByTestId("inventory-qty-input").fill(String(i));
      await clickSaveEntry(page);
      await expect(page.getByTestId("inventory-recent-block")).toContainText(RECENT_SAVED_RE, { timeout: 25_000 });
    }

  test("offline burst: many queued items sync without stuck pending (chromium only)", async ({ page, context }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Stress run on chromium only");
    test.slow();

    const suffix = buildSuffix(testInfo.project.name);
    const { warehouseId } = await prepareInventoryRevisionPage(page);
    await ensureActiveInventorySession(page.request, warehouseId);

    const names: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      const n = `E2E Burst ${suffix} ${i}`;
      names.push(n);
      await ensureInventoryItem(page.request, warehouseId, n);
    }

    await context.setOffline(true);
    for (const name of names) {
      await selectInventoryItemBySearch(page, name);
      await page.getByTestId("inventory-qty-input").fill("1");
      await clickSaveEntry(page);
      await expect(page.getByTestId("inventory-recent-block")).toContainText(RECENT_PENDING_RE, { timeout: 20_000 });
    }

    await context.setOffline(false);
    const recentBlock = page.getByTestId("inventory-recent-block");
    await expect
      .poll(async () => (await recentBlock.innerText()).toLowerCase(), { timeout: 120_000 })
      .toMatch(RECENT_SAVED_RE);

    await page.getByTestId("inventory-tab-reports").click();
    await expect(page.getByTestId("inventory-export-xlsx-btn").first()).toBeVisible({ timeout: 20_000 });
  });
});
