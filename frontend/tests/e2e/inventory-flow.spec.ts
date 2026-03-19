import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

type Zone = { id: number; name: string };
type Warehouse = { id: number; name: string; zone_id: number };
type Item = { id: number; name: string; unit: string; warehouse_id: number };

const E2E_USERNAME = process.env.E2E_USERNAME;
const E2E_PASSWORD = process.env.E2E_PASSWORD;

let preflightSkipReason: string | null = null;

async function runPreflight(request: APIRequestContext) {
  if (!E2E_USERNAME || !E2E_PASSWORD) {
    return "E2E credentials are not set (E2E_USERNAME/E2E_PASSWORD)";
  }

  try {
    const health = await request.get("/api/backend/health/live");
    if (!health.ok()) {
      return `backend health check failed (${health.status()})`;
    }

    const login = await request.post("/api/auth/login", {
      data: { username: E2E_USERNAME, password: E2E_PASSWORD },
    });
    if (!login.ok()) {
      return `auth preflight failed (${login.status()})`;
    }

    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "unknown preflight error";
  }
}

async function loginAs(page: Page, username: string, password: string) {
  await page.goto("/login");
  await page.getByTestId("login-username").fill(username);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();

  try {
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
  } catch {
    const errorLocator = page.locator("p.text-destructive").first();
    const hasError = await errorLocator.isVisible({ timeout: 500 }).catch(() => false);
    const errorText = hasError ? (await errorLocator.textContent()) ?? "Login failed" : "Login did not redirect";
    throw new Error(`Login failed in UI: ${errorText}`);
  }
}

async function login(page: Page) {
  if (!E2E_USERNAME || !E2E_PASSWORD) {
    throw new Error("E2E credentials are not set (E2E_USERNAME/E2E_PASSWORD)");
  }

  await loginAs(page, E2E_USERNAME, E2E_PASSWORD);
}

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

function buildFixtureNames(suffix: string) {
  return {
    zoneName: `E2E Zone ${suffix}`,
    warehouseName: `E2E Warehouse ${suffix}`,
    itemName: `E2E Item ${suffix}`,
  };
}

async function ensureInventoryItem(
  request: APIRequestContext,
  warehouseId: number,
  itemName: string,
  unit = "pcs",
) {
  const itemsResponse = await request.get(`/api/backend/items?warehouse_id=${warehouseId}`);
  expect(itemsResponse.ok()).toBeTruthy();
  const items = (await itemsResponse.json()) as Item[];

  let item = items.find((entry) => entry.name === itemName);
  if (!item) {
    const createItemResponse = await request.post("/api/backend/items", {
      data: {
        name: itemName,
        unit,
        warehouse_id: warehouseId,
        step: 1,
      },
    });
    expect(createItemResponse.ok()).toBeTruthy();
    item = (await createItemResponse.json()) as Item;
  }

  return item;
}

async function ensureInventoryFixtures(request: APIRequestContext, suffix: string) {
  const { zoneName, warehouseName, itemName } = buildFixtureNames(suffix);
  const zonesResponse = await request.get("/api/backend/zones");
  expect(zonesResponse.ok()).toBeTruthy();
  const zones = (await zonesResponse.json()) as Zone[];

  let zone = zones.find((entry) => entry.name === zoneName);
  if (!zone) {
    const createZoneResponse = await request.post("/api/backend/zones", {
      data: { name: zoneName, description: `Playwright zone ${suffix}` },
    });
    expect(createZoneResponse.ok()).toBeTruthy();
    zone = (await createZoneResponse.json()) as Zone;
  }

  const warehousesResponse = await request.get(`/api/backend/warehouses?zone_id=${zone.id}`);
  expect(warehousesResponse.ok()).toBeTruthy();
  const warehouses = (await warehousesResponse.json()) as Warehouse[];

  let warehouse = warehouses.find((entry) => entry.name === warehouseName);
  if (!warehouse) {
    const createWarehouseResponse = await request.post("/api/backend/warehouses", {
      data: { name: warehouseName, zone_id: zone.id },
    });
    expect(createWarehouseResponse.ok()).toBeTruthy();
    warehouse = (await createWarehouseResponse.json()) as Warehouse;
  }

  const item = await ensureInventoryItem(request, warehouse.id, itemName, "pcs");

  return { zone, warehouse, item };
}

async function openInventoryWithSelection(page: Page, zoneName: string, warehouseName: string) {
  await page.goto("/inventory");

  await page.getByTestId("inventory-zone-select").selectOption({ label: zoneName });
  await page.getByTestId("inventory-warehouse-select").selectOption({ label: warehouseName });

  await expect(page.getByText(/Session ID:/)).toBeVisible({ timeout: 20_000 });
}

async function selectInventoryItem(page: Page, itemName: string) {
  const searchInput = page.getByTestId("inventory-search-input");
  await searchInput.fill(itemName);

  const dropdownItem = page.getByTestId("inventory-search-dropdown").locator("button", { hasText: itemName }).first();
  await expect(dropdownItem).toBeVisible({ timeout: 10_000 });
  await dropdownItem.click();

  await expect(page.getByTestId("inventory-qty-input")).toBeFocused();
}

async function clickSaveEntry(page: Page) {
  const mobileSave = page.getByTestId("inventory-save-btn-mobile");
  const desktopSave = page.getByTestId("inventory-save-btn-desktop");

  if (await mobileSave.isVisible()) {
    await mobileSave.click();
    return;
  }
  await desktopSave.click();
}

async function getSessionIdFromPage(page: Page) {
  const sessionText = await page.getByText(/Session ID:/).innerText();
  const sessionIdMatch = sessionText.match(/(\d+)/);
  expect(sessionIdMatch).toBeTruthy();
  return Number(sessionIdMatch?.[1]);
}

async function getProgressCounts(page: Page) {
  const total = Number.parseInt((await page.getByTestId("inventory-progress-total").innerText()).trim(), 10);
  const mine = Number.parseInt((await page.getByTestId("inventory-progress-mine").innerText()).trim(), 10);
  const lastChange = (await page.getByTestId("inventory-progress-last-change").innerText()).trim();
  return { total, mine, lastChange }; 
}

async function createSecondaryUser(
  request: APIRequestContext,
  warehouseId: number,
  suffix: string,
) {
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
    const suffix = `${test.info().project.name}-${Date.now()}`.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
    await login(page);
    const { zone, warehouse, item } = await ensureInventoryFixtures(page.request, suffix);

    await openInventoryWithSelection(page, zone.name, warehouse.name);
    await selectInventoryItem(page, item.name);

    await page.getByTestId("inventory-qty-input").fill("3");
    await clickSaveEntry(page);

    const recentBlock = page.getByTestId("inventory-recent-block");
    await expect(recentBlock).toContainText(item.name, { timeout: 15_000 });
    await expect(recentBlock).toContainText("saved", { timeout: 15_000 });
  });

  test("offline enqueue -> reload -> relogin keeps pending visible", async ({ page, context }) => {
    const suffix = `${test.info().project.name}-${Date.now()}`.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
    await login(page);
    const { zone, warehouse, item } = await ensureInventoryFixtures(page.request, suffix);
    const pendingItem = await ensureInventoryItem(page.request, warehouse.id, `E2E Pending ${suffix}`);

    await openInventoryWithSelection(page, zone.name, warehouse.name);
    const sessionId = await getSessionIdFromPage(page);

    for (let quantity = 1; quantity <= 24; quantity += 1) {
      const response = await page.request.post(`/api/backend/inventory/sessions/${sessionId}/entries`, {
        data: { item_id: item.id, quantity, mode: "set" },
      });
      expect(response.ok()).toBeTruthy();
    }

    await selectInventoryItem(page, pendingItem.name);

    await context.setOffline(true);
    await page.getByTestId("inventory-qty-input").fill("4");
    await clickSaveEntry(page);

    const recentBlock = page.getByTestId("inventory-recent-block");
    await expect(recentBlock).toContainText(pendingItem.name, { timeout: 15_000 });
    await expect(recentBlock).toContainText("pending", { timeout: 15_000 });

    await context.route("**/api/backend/health", async (route) => {
      await route.abort();
    });
    await context.setOffline(false);

    await page.goto("/inventory");
    await openInventoryWithSelection(page, zone.name, warehouse.name);
    await expect(page.getByTestId("inventory-recent-block")).toContainText(pendingItem.name, {
      timeout: 15_000,
    });
    await expect(page.getByTestId("inventory-recent-block")).toContainText("pending", {
      timeout: 15_000,
    });

    await logout(page);
    await login(page);
    await openInventoryWithSelection(page, zone.name, warehouse.name);
    await expect(page.getByTestId("inventory-recent-block")).toContainText(pendingItem.name, {
      timeout: 15_000,
    });
    await expect(page.getByTestId("inventory-recent-block")).toContainText("pending", {
      timeout: 15_000,
    });
  });

  test("save updates progress without manual reload", async ({ page }) => {
    const suffix = `${test.info().project.name}-${Date.now()}`.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
    await login(page);
    const { zone, warehouse, item } = await ensureInventoryFixtures(page.request, suffix);

    await openInventoryWithSelection(page, zone.name, warehouse.name);

    await expect.poll(async () => (await getProgressCounts(page)).total, { timeout: 15_000 }).toBe(0);
    await expect.poll(async () => (await getProgressCounts(page)).mine, { timeout: 15_000 }).toBe(0);

    await selectInventoryItem(page, item.name);
    await page.getByTestId("inventory-qty-input").fill("3");
    await clickSaveEntry(page);

    const recentBlock = page.getByTestId("inventory-recent-block");
    await expect(recentBlock).toContainText(item.name, { timeout: 15_000 });
    await expect(recentBlock).toContainText("saved", { timeout: 15_000 });
    await expect.poll(async () => (await getProgressCounts(page)).total, { timeout: 15_000 }).toBe(1);
    await expect.poll(async () => (await getProgressCounts(page)).mine, { timeout: 15_000 }).toBe(1);
    await expect(page.getByTestId("inventory-progress-last-change")).not.toContainText("—", {
      timeout: 15_000,
    });
  });

  test("relogin restores inventory bootstrap and reload keeps auth", async ({ page }) => {
    const suffix = `${test.info().project.name}-${Date.now()}`.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
    await login(page);
    const { zone, warehouse, item } = await ensureInventoryFixtures(page.request, suffix);

    await openInventoryWithSelection(page, zone.name, warehouse.name);
    await selectInventoryItem(page, item.name);
    await page.getByTestId("inventory-qty-input").fill("5");
    await clickSaveEntry(page);

    const recentBlock = page.getByTestId("inventory-recent-block");
    await expect(recentBlock).toContainText(item.name, { timeout: 15_000 });
    await expect(recentBlock).toContainText("saved", { timeout: 15_000 });

    await logout(page);
    await login(page);

    await openInventoryWithSelection(page, zone.name, warehouse.name);
    await expect(page.getByText(/Session ID:/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("inventory-progress-card")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("inventory-recent-block")).toContainText(item.name, {
      timeout: 15_000,
    });

    await page.reload();

    await expect(page).toHaveURL(/\/inventory/, { timeout: 20_000 });
    await expect(page.getByText(/Session ID:/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("inventory-progress-card")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("inventory-recent-block")).toContainText(item.name, {
      timeout: 15_000,
    });
    await expect(page.getByTestId("login-submit")).toHaveCount(0);
  });

  test("my/all toggle persists after reload and does not hide valid entries", async ({ page }) => {
    const suffix = `${test.info().project.name}-${Date.now()}`.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
    await login(page);
    const { zone, warehouse } = await ensureInventoryFixtures(page.request, suffix);
    const remoteItem = await ensureInventoryItem(page.request, warehouse.id, `E2E Remote ${suffix}`);
    await openInventoryWithSelection(page, zone.name, warehouse.name);

    const secondary = await createSecondaryUser(page.request, warehouse.id, suffix);
    if (secondary.response.status() === 403) {
      test.skip(true, "E2E user cannot create a secondary warehouse user");
    }
    expect(secondary.response.status()).toBe(201);

    await logout(page);
    await loginAs(page, secondary.username, secondary.password);
    await openInventoryWithSelection(page, zone.name, warehouse.name);
    await selectInventoryItem(page, remoteItem.name);
    await page.getByTestId("inventory-qty-input").fill("2");
    await clickSaveEntry(page);
    await expect(page.getByTestId("inventory-recent-block")).toContainText(remoteItem.name, {
      timeout: 15_000,
    });

    await logout(page);
    await login(page);
    await openInventoryWithSelection(page, zone.name, warehouse.name);

    const recentBlock = page.getByTestId("inventory-recent-block");
    await expect(recentBlock).toContainText(remoteItem.name, { timeout: 15_000 });

    await page.getByTestId("inventory-recent-filter-mine").click();
    await expect(recentBlock).not.toContainText(remoteItem.name, { timeout: 10_000 });

    await page.getByTestId("inventory-recent-filter-all").click();
    await expect(recentBlock).toContainText(remoteItem.name, { timeout: 10_000 });

    await page.goto("/inventory");
    await openInventoryWithSelection(page, zone.name, warehouse.name);
    await expect(page.getByTestId("inventory-recent-block")).toContainText(remoteItem.name, {
      timeout: 15_000,
    });
  });

  test("reconnect and sync do not clear recent entries", async ({ page, context }) => {
    const suffix = `${test.info().project.name}-${Date.now()}`.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
    await login(page);
    const { zone, warehouse, item } = await ensureInventoryFixtures(page.request, suffix);

    await openInventoryWithSelection(page, zone.name, warehouse.name);
    await selectInventoryItem(page, item.name);

    await context.setOffline(true);
    await page.getByTestId("inventory-qty-input").fill("4");
    await clickSaveEntry(page);

    const recentBlock = page.getByTestId("inventory-recent-block");
    await expect(recentBlock).toContainText(item.name, { timeout: 15_000 });
    await expect(recentBlock).toContainText("pending", { timeout: 15_000 });

    await context.setOffline(false);
    await expect
      .poll(async () => (await recentBlock.innerText()).toLowerCase(), { timeout: 30_000 })
      .toContain("saved");

    await page.evaluate(() => {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("online"));
    });

    await expect(recentBlock).toContainText(item.name, { timeout: 15_000 });
    await expect
      .poll(async () => (await recentBlock.innerText()).toLowerCase(), { timeout: 15_000 })
      .toContain("saved");
  });

  test("export download exists", async ({ page }) => {
    const suffix = `${test.info().project.name}-${Date.now()}`.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
    await login(page);
    const { zone, warehouse } = await ensureInventoryFixtures(page.request, suffix);

    await openInventoryWithSelection(page, zone.name, warehouse.name);

    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("inventory-export-btn").click();
    const download = await downloadPromise;

    expect(download.suggestedFilename().toLowerCase()).toContain("inventory");
    expect(download.suggestedFilename().toLowerCase()).toContain(".xlsx");
  });

  test("closed session blocks input", async ({ page }) => {
    const suffix = `${test.info().project.name}-${Date.now()}`.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
    await login(page);
    const { zone, warehouse, item } = await ensureInventoryFixtures(page.request, suffix);

    await openInventoryWithSelection(page, zone.name, warehouse.name);
    await selectInventoryItem(page, item.name);
    await page.getByTestId("inventory-qty-input").fill("2");

    const sessionId = await getSessionIdFromPage(page);

    const closeResponse = await page.request.post(`/api/backend/inventory/sessions/${sessionId}/close`, {
      data: { reason: "e2e-close" },
    });
    expect(closeResponse.ok()).toBeTruthy();

    await clickSaveEntry(page);

    await expect(page.getByText("Сессия закрыта")).toBeVisible({ timeout: 20_000 });
  });
});
