import { NextRequest, NextResponse } from "next/server";

import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from "@/lib/api/auth-cookie";
import { API_BASE_URL, API_ROUTES, makeApiUrl } from "@/lib/api/client";

const BACKEND_REQUEST_TIMEOUT_MS = 4500;

export async function POST(request: NextRequest) {
  if (!API_BASE_URL) {
    return NextResponse.json(
      { error: "API_BASE_URL/NEXT_PUBLIC_API_BASE_URL is not configured" },
      { status: 500 },
    );
  }

  const payload = (await request.json()) as { username?: string; password?: string };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), BACKEND_REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(makeApiUrl(API_ROUTES.auth.login), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: payload.username ?? "",
        password: payload.password ?? "",
      }),
      signal: controller.signal,
    });
  } catch (error) {
    const message =
      error instanceof DOMException && error.name === "AbortError"
        ? "Backend request timeout"
        : "Backend request failed";
    return NextResponse.json(
      { error: message },
      { status: message.includes("timeout") ? 504 : 502 },
    );
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const text = await response.text();
    return NextResponse.json({ error: text || "Login failed" }, { status: response.status });
  }

  const data = (await response.json()) as { access_token?: string; refresh_token?: string };
  const token = data.access_token;
  const refreshToken = data.refresh_token;
  if (!token || !refreshToken) {
    return NextResponse.json({ error: "Missing access token" }, { status: 502 });
  }

  const next = NextResponse.json({ ok: true });
  next.cookies.set(ACCESS_TOKEN_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  next.cookies.set(REFRESH_TOKEN_COOKIE, refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 14,
  });

  return next;
}
