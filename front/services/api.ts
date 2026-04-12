import { Platform } from "react-native";

import type {
  LoginPayload,
  RegisterPayload,
  TokenResponse,
  UserPublic,
} from "@/types/auth";

const fallbackApiBase =
  Platform.select({
    android: "http://10.0.2.2:8000",
    default: "http://127.0.0.1:8000",
  }) ?? "http://127.0.0.1:8000";

export const API_BASE = (process.env.EXPO_PUBLIC_API_BASE_URL ?? fallbackApiBase).replace(
  /\/+$/,
  ""
);

export const API_BASE_IS_DEFAULT = !process.env.EXPO_PUBLIC_API_BASE_URL;

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

async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(init.headers);
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

    throw new ApiError(0, `无法连接服务器，请检查接口地址：${API_BASE}`, error);
  }
}

export const authApi = {
  login(payload: LoginPayload) {
    return request<TokenResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  register(payload: RegisterPayload) {
    return request<TokenResponse>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  me(token: string) {
    return request<UserPublic>("/api/me", { method: "GET" }, token);
  },
};
