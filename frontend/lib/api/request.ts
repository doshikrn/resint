type ApiRequestInit = Omit<RequestInit, "body"> & {
  body?: unknown;
  timeoutMs?: number;
};

export class ApiRequestError extends Error {
  status: number;
  body: string;

  constructor(status: number, body: string) {
    super(body || `Request failed: ${status}`);
    this.name = "ApiRequestError";
    this.status = status;
    this.body = body;
  }
}

export function toProxyUrl(path: string): string {
  return `/api/backend${path}`;
}

export async function apiGetWithResponse(
  path: string,
  init: Omit<ApiRequestInit, "body"> = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");

  const timeoutMs = init.timeoutMs;
  const controller = timeoutMs ? new AbortController() : undefined;
  const timeoutId = timeoutMs
    ? setTimeout(() => {
        controller?.abort();
      }, timeoutMs)
    : undefined;

  try {
    return await fetch(toProxyUrl(path), {
      ...init,
      method: "GET",
      headers,
      signal: controller?.signal,
      cache: "no-store",
    });
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

export function parseFilenameFromContentDisposition(contentDisposition: string | null): string | null {
  if (!contentDisposition) {
    return null;
  }

  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1]);
  }

  const asciiMatch = contentDisposition.match(/filename="?([^";]+)"?/i);
  if (asciiMatch?.[1]) {
    return asciiMatch[1];
  }

  return null;
}

export async function apiRequest<T>(path: string, init: ApiRequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");

  const timeoutMs = init.timeoutMs;
  const controller = timeoutMs ? new AbortController() : undefined;
  const timeoutId = timeoutMs
    ? setTimeout(() => {
        controller?.abort();
      }, timeoutMs)
    : undefined;

  let body: BodyInit | undefined;
  if (init.body !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(init.body);
  }

  let response: Response;
  try {
    response = await fetch(toProxyUrl(path), {
      ...init,
      headers,
      body,
      signal: controller?.signal ?? init.signal,
      credentials: "include",
      cache: "no-store",
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiRequestError(0, "Request timeout");
    }
    throw new ApiRequestError(0, "Network error");
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }

  if (!response.ok) {
    const text = await response.text();
    throw new ApiRequestError(response.status, text);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}
