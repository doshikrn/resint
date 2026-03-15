import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from "@/lib/api/auth-cookie";
import { API_BASE_URL, API_ROUTES, makeApiUrl } from "@/lib/api/client";

const BACKEND_REQUEST_TIMEOUT_MS = 4500;
const BACKEND_LONG_REQUEST_TIMEOUT_MS = 120_000;

// Paths that may take longer (e.g. pg_dump, restore)
const LONG_TIMEOUT_PREFIXES = ["/admin/backups/create", "/admin/backups/restore"];

const FORWARDED_REQUEST_HEADERS = new Set([
  "accept",
  "if-none-match",
  "if-modified-since",
  "if-match",
  "idempotency-key",
  "x-request-id",
]);

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "upgrade",
]);

async function forward(request: NextRequest, path: string[]) {
  if (!API_BASE_URL) {
    return NextResponse.json(
      { error: "API_BASE_URL/NEXT_PUBLIC_API_BASE_URL is not configured" },
      { status: 500 },
    );
  }

  const cookieStore = cookies();
  let token = cookieStore.get(ACCESS_TOKEN_COOKIE)?.value ?? null;
  let refreshToken = cookieStore.get(REFRESH_TOKEN_COOKIE)?.value ?? null;

  const base = API_BASE_URL.endsWith("/") ? API_BASE_URL.slice(0, -1) : API_BASE_URL;
  const joinedPath = path.join("/");
  const targetUrl = new URL(`${base}/${joinedPath}`);
  request.nextUrl.searchParams.forEach((value, key) => {
    targetUrl.searchParams.append(key, value);
  });

  const headers = new Headers();
  const incomingContentType = request.headers.get("content-type");
  if (incomingContentType) {
    headers.set("content-type", incomingContentType);
  }

  request.headers.forEach((value, key) => {
    if (FORWARDED_REQUEST_HEADERS.has(key.toLowerCase())) {
      headers.set(key, value);
    }
  });

  let body: string | undefined;
  if (request.method !== "GET" && request.method !== "HEAD") {
    body = await request.text();
  }

  const requestPath = "/" + path.join("/");
  const timeoutMs = LONG_TIMEOUT_PREFIXES.some((p) => requestPath.startsWith(p))
    ? BACKEND_LONG_REQUEST_TIMEOUT_MS
    : BACKEND_REQUEST_TIMEOUT_MS;

  const sendToBackend = async (accessToken: string) => {
    const requestHeaders = new Headers(headers);
    requestHeaders.set("authorization", `Bearer ${accessToken}`);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(targetUrl.toString(), {
        method: request.method,
        headers: requestHeaders,
        body: body && body.length > 0 ? body : undefined,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  };

  const tryRefresh = async (rawRefreshToken: string) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), BACKEND_REQUEST_TIMEOUT_MS);
    let refreshResponse: Response;
    try {
      refreshResponse = await fetch(makeApiUrl(API_ROUTES.auth.refresh), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refresh_token: rawRefreshToken }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!refreshResponse.ok) {
      return null;
    }

    const refreshed = (await refreshResponse.json()) as {
      access_token?: string;
      refresh_token?: string;
    };

    if (!refreshed.access_token || !refreshed.refresh_token) {
      return null;
    }

    return refreshed;
  };

  let nextAccessToken: string | null = null;
  let nextRefreshToken: string | null = null;

  if (!token && refreshToken) {
    try {
      const refreshed = await tryRefresh(refreshToken);
      if (refreshed) {
        token = refreshed.access_token ?? null;
        refreshToken = refreshed.refresh_token ?? null;
        nextAccessToken = refreshed.access_token ?? null;
        nextRefreshToken = refreshed.refresh_token ?? null;
      }
    } catch {}
  }

  if (!token) {
    const unauthorized = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    unauthorized.cookies.set(ACCESS_TOKEN_COOKIE, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
    unauthorized.cookies.set(REFRESH_TOKEN_COOKIE, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
    return unauthorized;
  }

  let backendResponse: Response;
  try {
    backendResponse = await sendToBackend(token);
  } catch (error) {
    const message =
      error instanceof DOMException && error.name === "AbortError"
        ? "Backend request timeout"
        : "Backend request failed";
    return NextResponse.json(
      { error: message },
      { status: message.includes("timeout") ? 504 : 502 },
    );
  }

  if (backendResponse.status === 401 && refreshToken) {
    try {
      const refreshed = await tryRefresh(refreshToken);
      if (refreshed?.access_token && refreshed.refresh_token) {
        nextAccessToken = refreshed.access_token;
        nextRefreshToken = refreshed.refresh_token;
        try {
          backendResponse = await sendToBackend(refreshed.access_token);
        } catch (error) {
          const message =
            error instanceof DOMException && error.name === "AbortError"
              ? "Backend request timeout"
              : "Backend request failed";
          return NextResponse.json(
            { error: message },
            { status: message.includes("timeout") ? 504 : 502 },
          );
        }
      }
    } catch {}
  }

  const responseHeaders = new Headers();
  backendResponse.headers.forEach((value, key) => {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      responseHeaders.set(key, value);
    }
  });

  const response = new NextResponse(backendResponse.body, {
    status: backendResponse.status,
    headers: responseHeaders,
  });

  if (nextAccessToken && nextRefreshToken) {
    response.cookies.set(ACCESS_TOKEN_COOKIE, nextAccessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 12,
    });
    response.cookies.set(REFRESH_TOKEN_COOKIE, nextRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 14,
    });
  }

  if (backendResponse.status === 401) {
    response.cookies.set(ACCESS_TOKEN_COOKIE, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
    response.cookies.set(REFRESH_TOKEN_COOKIE, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
  }

  return response;
}

export async function GET(request: NextRequest, context: { params: { path: string[] } }) {
  return forward(request, context.params.path);
}

export async function POST(request: NextRequest, context: { params: { path: string[] } }) {
  return forward(request, context.params.path);
}

export async function PATCH(request: NextRequest, context: { params: { path: string[] } }) {
  return forward(request, context.params.path);
}

export async function PUT(request: NextRequest, context: { params: { path: string[] } }) {
  return forward(request, context.params.path);
}

export async function DELETE(request: NextRequest, context: { params: { path: string[] } }) {
  return forward(request, context.params.path);
}
