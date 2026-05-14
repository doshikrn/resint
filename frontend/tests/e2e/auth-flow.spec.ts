import { expect, test } from "@playwright/test";

import { loginWithEnv, runPreflight } from "./helpers/inventory-e2e";

const ACCESS_TOKEN_COOKIE = "rr_access_token";
const REFRESH_TOKEN_COOKIE = "rr_refresh_token";

let preflightSkipReason: string | null = null;

test.describe("Auth and middleware", () => {
  test.beforeAll(async ({ request }) => {
    preflightSkipReason = await runPreflight(request);
  });

  test.beforeEach(async () => {
    test.skip(Boolean(preflightSkipReason), `Preflight failed: ${preflightSkipReason}`);
  });

  test("unauthenticated user is redirected from /inventory to /login", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/inventory");
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
    await context.close();
  });

  test("login sets cookies and logout clears them", async ({ page, context }) => {
    await page.goto("/login");
    await page.getByTestId("login-username").fill(process.env.E2E_USERNAME!);
    await page.getByTestId("login-password").fill(process.env.E2E_PASSWORD!);
    await page.getByTestId("login-submit").click();
    await expect(page).toHaveURL(/\/inventory/, { timeout: 25_000 });

    const afterLogin = await context.cookies();
    const names = afterLogin.map((c) => c.name);
    expect(names.some((n) => n === ACCESS_TOKEN_COOKIE || n === REFRESH_TOKEN_COOKIE)).toBeTruthy();

    await page.evaluate(async () => {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include", cache: "no-store" });
    });
    await page.goto("/inventory");
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });

    const afterLogout = await context.cookies();
    const access = afterLogout.find((c) => c.name === ACCESS_TOKEN_COOKIE);
    const refresh = afterLogout.find((c) => c.name === REFRESH_TOKEN_COOKIE);
    expect(!access?.value && !refresh?.value).toBeTruthy();
  });

  test("invalid credentials show error and stay on login", async ({ page }) => {
    await page.goto("/login");
    await page.getByTestId("login-username").fill(process.env.E2E_USERNAME!);
    await page.getByTestId("login-password").fill("__definitely_wrong_password__");
    await page.getByTestId("login-submit").click();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator("p.text-destructive").first()).toBeVisible({ timeout: 10_000 });
  });

  test("parallel /users/me fetches after login all succeed (refresh dedup sanity)", async ({ page }) => {
    await loginWithEnv(page);
    const oks = await page.evaluate(async () => {
      const urls = Array.from({ length: 12 }, () => "/api/backend/users/me");
      const responses = await Promise.all(
        urls.map((u) => fetch(u, { credentials: "include", cache: "no-store" })),
      );
      return responses.map((r) => r.ok);
    });
    expect(oks.every(Boolean)).toBeTruthy();
  });
});
