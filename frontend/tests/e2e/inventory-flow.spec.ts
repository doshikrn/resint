import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

type Zone = { id: number; name: string };
type Warehouse = { id: number; name: string; zone_id: number };
type Item = { id: number; name: string; unit: string; warehouse_id: number };

const TEST_ZONE_NAME = "E2E Zone";
const TEST_WAREHOUSE_NAME = "E2E Warehouse";
const TEST_ITEM_NAME = "E2E Item Pcs";
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

async function login(page: Page) {
  if (!E2E_USERNAME || !E2E_PASSWORD) {
    throw new Error("E2E credentials are not set (E2E_USERNAME/E2E_PASSWORD)");
  }

  await page.goto("/login");
  await page.getByTestId("login-username").fill(E2E_USERNAME);
  await page.getByTestId("login-password").fill(E2E_PASSWORD);
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

async function ensureInventoryFixtures(request: APIRequestContext) {
  const zonesResponse = await request.get("/api/backend/zones");
  expect(zonesResponse.ok()).toBeTruthy();
  const zones = (await zonesResponse.json()) as Zone[];

  let zone = zones.find((entry) => entry.name === TEST_ZONE_NAME);
  if (!zone) {
    const createZoneResponse = await request.post("/api/backend/zones", {
      data: { name: TEST_ZONE_NAME, description: "Playwright zone" },
    });
    expect(createZoneResponse.ok()).toBeTruthy();
    zone = (await createZoneResponse.json()) as Zone;
  }

  const warehousesResponse = await request.get(`/api/backend/warehouses?zone_id=${zone.id}`);
  expect(warehousesResponse.ok()).toBeTruthy();
  const warehouses = (await warehousesResponse.json()) as Warehouse[];

  let warehouse = warehouses.find((entry) => entry.name === TEST_WAREHOUSE_NAME);
  if (!warehouse) {
    const createWarehouseResponse = await request.post("/api/backend/warehouses", {
      data: { name: TEST_WAREHOUSE_NAME, zone_id: zone.id },
    });
    expect(createWarehouseResponse.ok()).toBeTruthy();
    warehouse = (await createWarehouseResponse.json()) as Warehouse;
  }

  const itemsResponse = await request.get(`/api/backend/items?warehouse_id=${warehouse.id}`);
  expect(itemsResponse.ok()).toBeTruthy();
  const items = (await itemsResponse.json()) as Item[];

  let item = items.find((entry) => entry.name === TEST_ITEM_NAME);
  if (!item) {
    const createItemResponse = await request.post("/api/backend/items", {
      data: {
        name: TEST_ITEM_NAME,
        unit: "pcs",
        warehouse_id: warehouse.id,
        step: 1,
      },
    });
    expect(createItemResponse.ok()).toBeTruthy();
    item = (await createItemResponse.json()) as Item;
  }

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

test.describe("Inventory revision critical flow", () => {
  test.beforeAll(async ({ request }) => {
    preflightSkipReason = await runPreflight(request);
  });

  test.beforeEach(async () => {
    test.skip(Boolean(preflightSkipReason), `Preflight failed: ${preflightSkipReason}`);
  });

  test("login -> inventory -> search/select -> save -> recent visible", async ({ page }) => {
    await login(page);
    const { zone, warehouse, item } = await ensureInventoryFixtures(page.request);

    await openInventoryWithSelection(page, zone.name, warehouse.name);
    await selectInventoryItem(page, item.name);

    await page.getByTestId("inventory-qty-input").fill("3");
    await clickSaveEntry(page);

    const recentBlock = page.getByTestId("inventory-recent-block");
    await expect(recentBlock).toContainText(item.name, { timeout: 15_000 });
    await expect(recentBlock).toContainText("saved", { timeout: 15_000 });
  });

  test("offline queue -> online sync", async ({ page, context }) => {
    await login(page);
    const { zone, warehouse, item } = await ensureInventoryFixtures(page.request);

    await openInventoryWithSelection(page, zone.name, warehouse.name);
    await selectInventoryItem(page, item.name);

    await context.setOffline(true);
    await page.getByTestId("inventory-qty-input").fill("4");
    await clickSaveEntry(page);

    const recentBlock = page.getByTestId("inventory-recent-block");
    await expect(recentBlock).toContainText("pending", { timeout: 15_000 });

    await context.setOffline(false);
    await expect
      .poll(async () => (await recentBlock.innerText()).toLowerCase(), { timeout: 30_000 })
      .toContain("saved");
  });

  test("export download exists", async ({ page }) => {
    await login(page);
    const { zone, warehouse } = await ensureInventoryFixtures(page.request);

    await openInventoryWithSelection(page, zone.name, warehouse.name);

    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("inventory-export-btn").click();
    const download = await downloadPromise;

    expect(download.suggestedFilename().toLowerCase()).toContain("inventory");
    expect(download.suggestedFilename().toLowerCase()).toContain(".xlsx");
  });

  test("closed session blocks input", async ({ page }) => {
    await login(page);
    const { zone, warehouse, item } = await ensureInventoryFixtures(page.request);

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
