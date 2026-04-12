const fallbackApiBase = "http://127.0.0.1:8000";

export const API_BASE = (process.env.EXPO_PUBLIC_API_BASE_URL ?? fallbackApiBase).replace(
  /\/+$/,
  ""
);

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly detail?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const REQUEST_TIMEOUT_MS = 12000;

function tryParseJson(raw: string) {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function getErrorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") {
    return fallback;
  }

  const detail = (payload as { detail?: unknown }).detail;

  if (typeof detail === "string") {
    return detail;
  }

  if (Array.isArray(detail) && detail.length > 0) {
    const messages = detail
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }

        if (item && typeof item === "object" && "msg" in item) {
          const msg = (item as { msg?: unknown }).msg;
          return typeof msg === "string" ? msg : null;
        }

        return null;
      })
      .filter(Boolean);

    if (messages.length > 0) {
      return messages.join("；");
    }
  }

  return fallback;
}

export async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(init.headers);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  headers.set("Accept", "application/json");

  if (!(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers,
      signal: controller.signal,
    });

    const raw = await response.text();
    const payload = raw ? tryParseJson(raw) : null;

    if (!response.ok) {
      throw new ApiError(
        response.status,
        getErrorMessage(payload, `请求失败（${response.status}）`),
        payload
      );
    }

    return payload as T;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    const message =
      error instanceof Error && error.name === "AbortError"
        ? "请求超时，请检查网络后重试"
        : "当前服务暂时不可用，请稍后再试";

    throw new ApiError(0, message, error);
  } finally {
    clearTimeout(timeoutId);
  }
}
