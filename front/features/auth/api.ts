import { request } from "@/shared/api";
import type {
  LoginPayload,
  RegisterPayload,
  TokenResponse,
  UserPublic,
} from "./types";

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
