import { expect, test, type Page } from "@playwright/test";

const E2E_USERNAME = process.env.E2E_USERNAME;
const E2E_PASSWORD = process.env.E2E_PASSWORD;

async function login(page: Page) {
  if (!E2E_USERNAME || !E2E_PASSWORD) {
    throw new Error("E2E credentials are not set (E2E_USERNAME/E2E_PASSWORD)");
  }

  await page.goto("/login");
  await page.getByTestId("login-username").fill(E2E_USERNAME);
  await page.getByTestId("login-password").fill(E2E_PASSWORD);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/inventory/, { timeout: 20_000 });
}

test.describe("Presence flow", () => {
  test.beforeEach(async () => {
    test.skip(!E2E_USERNAME || !E2E_PASSWORD, "Preflight failed: E2E credentials are not set");
  });

  test("login and reload keep online badge consistent", async ({ page }) => {
    await login(page);

    await expect(page.getByTestId("app-online-users-badge")).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(async () => Number.parseInt(await page.getByTestId("app-online-users-count").innerText(), 10), {
        timeout: 20_000,
      })
      .toBeGreaterThan(0);

    await page.reload();

    await expect(page).toHaveURL(/\/inventory/, { timeout: 20_000 });
    await expect(page.getByTestId("app-online-users-badge")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("app-online-users-badge").hover();
    await expect(page.getByTestId("app-online-users-panel")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("app-online-user-row").first()).toBeVisible({ timeout: 20_000 });
  });

  test("second tab does not duplicate the same user in badge count", async ({ browser }) => {
    const context = await browser.newContext();
    const firstPage = await context.newPage();
    const secondPage = await context.newPage();

    await login(firstPage);
    await expect
      .poll(async () => Number.parseInt(await firstPage.getByTestId("app-online-users-count").innerText(), 10), {
        timeout: 20_000,
      })
      .toBeGreaterThan(0);
    const initialCount = Number.parseInt(
      await firstPage.getByTestId("app-online-users-count").innerText(),
      10,
    );
    await secondPage.goto("/inventory");

    await expect(firstPage.getByTestId("app-online-users-badge")).toBeVisible({ timeout: 20_000 });
    await expect(secondPage.getByTestId("app-online-users-badge")).toBeVisible({ timeout: 20_000 });

    await expect
      .poll(async () => Number.parseInt(await firstPage.getByTestId("app-online-users-count").innerText(), 10), {
        timeout: 20_000,
      })
      .toBe(Number(initialCount));

    await context.close();
  });
});