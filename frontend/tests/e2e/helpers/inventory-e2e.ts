import { expect } from "@playwright/test";
import type { APIRequestContext, Page } from "@playwright/test";

export const E2E_USERNAME = process.env.E2E_USERNAME;
export const E2E_PASSWORD = process.env.E2E_PASSWORD;

export type MeUser = {
  id: number;
  role: string;
  warehouse_id: number | null;
  default_warehouse_id: number | null;
};

export type InventoryItem = { id: number; name: string; unit: string; warehouse_id: number };

export type ActiveSession = {
  id: number;
  revision_no: number;
  warehouse_id: number;
  is_closed: boolean;
  status: string;
};

export async function runPreflight(request: APIRequestContext): Promise<string | null> {
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

export async function apiGetMe(request: APIRequestContext): Promise<MeUser> {
  const r = await request.get("/api/backend/users/me");
  expect(r.ok()).toBeTruthy();
  return (await r.json()) as MeUser;
}

export function resolveWarehouseId(me: MeUser): number {
  const w = me.warehouse_id ?? me.default_warehouse_id;
  if (w == null) {
    throw new Error("E2E user has no warehouse_id / default_warehouse_id");
  }
  return w;
}

export async function loginAs(page: Page, username: string, password: string) {
  await page.goto("/login");
  await page.getByTestId("login-username").fill(username);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/inventory/, { timeout: 25_000 });
}

export async function loginWithEnv(page: Page) {
  if (!E2E_USERNAME || !E2E_PASSWORD) {
    throw new Error("E2E credentials are not set (E2E_USERNAME/E2E_PASSWORD)");
  }
  await loginAs(page, E2E_USERNAME, E2E_PASSWORD);
}

export async function ensureActiveInventorySession(
  request: APIRequestContext,
  warehouseId: number,
): Promise<ActiveSession> {
  const r = await request.post("/api/backend/inventory/sessions/active", {
    data: { warehouse_id: warehouseId, create_if_missing: true },
  });
  expect(r.ok()).toBeTruthy();
  return (await r.json()) as ActiveSession;
}

export async function ensureInventoryItem(
  request: APIRequestContext,
  warehouseId: number,
  itemName: string,
  unit = "pcs",
  step?: number,
): Promise<InventoryItem> {
  const itemsResponse = await request.get(`/api/backend/items?warehouse_id=${warehouseId}`);
  expect(itemsResponse.ok()).toBeTruthy();
  const items = (await itemsResponse.json()) as InventoryItem[];

  let item = items.find((entry) => entry.name === itemName);
  if (!item) {
    const resolvedStep = step ?? (unit === "pcs" ? 1 : 0.01);
    const createItemResponse = await request.post("/api/backend/items", {
      data: {
        name: itemName,
        unit,
        warehouse_id: warehouseId,
        step: resolvedStep,
      },
    });
    expect(createItemResponse.ok()).toBeTruthy();
    item = (await createItemResponse.json()) as InventoryItem;
  }

  return item;
}

/** Login, resolve warehouse, ensure draft session exists, open /inventory and wait for fast-entry. */
export async function prepareInventoryRevisionPage(page: Page) {
  await loginWithEnv(page);
  const me = await apiGetMe(page.request);
  const warehouseId = resolveWarehouseId(me);
  await ensureActiveInventorySession(page.request, warehouseId);
  await page.goto("/inventory");
  await expect(page.getByTestId("inventory-progress-card")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("inventory-search-input")).toBeEnabled({ timeout: 30_000 });
  return { me, warehouseId };
}

/** After UI login (any user), ensure session and open /inventory revision. */
export async function resumeInventoryRevisionPage(page: Page) {
  const me = await apiGetMe(page.request);
  const warehouseId = resolveWarehouseId(me);
  await ensureActiveInventorySession(page.request, warehouseId);
  await page.goto("/inventory");
  await expect(page.getByTestId("inventory-progress-card")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("inventory-search-input")).toBeEnabled({ timeout: 30_000 });
  return { me, warehouseId };
}

export async function selectInventoryItemBySearch(page: Page, itemName: string) {
  const searchInput = page.getByTestId("inventory-search-input");
  await searchInput.fill(itemName);
  const dropdownItem = page
    .getByTestId("inventory-search-dropdown")
    .locator("button", { hasText: itemName })
    .first();
  await expect(dropdownItem).toBeVisible({ timeout: 15_000 });
  await dropdownItem.click();
  await expect(page.getByTestId("inventory-qty-input")).toBeFocused({ timeout: 10_000 });
}

export async function clickSaveEntry(page: Page) {
  const mobileSave = page.getByTestId("inventory-save-btn-mobile");
  const desktopSave = page.getByTestId("inventory-save-btn-desktop");

  if (await mobileSave.isVisible()) {
    await mobileSave.click();
    return;
  }
  await desktopSave.click();
}

/** Russian journal labels (default i18n in app). */
export const RECENT_SAVED_RE = /сохранено/i;
export const RECENT_PENDING_RE = /в очереди/i;
