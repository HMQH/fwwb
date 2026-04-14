import { request } from "@/shared/api";
import type {
  LoginPayload,
  LocalImageAsset,
  RegisterPayload,
  TokenResponse,
  UpdateGuardianPayload,
  UserPublic,
} from "./types";

const AVATAR_UPLOAD_TIMEOUT_MS = 60_000;

function appendImage(formData: FormData, key: string, file: LocalImageAsset | null | undefined) {
  if (!file) {
    return;
  }

  formData.append(
    key,
    {
      uri: file.uri,
      name: file.name,
      type: file.mimeType,
    } as any
  );
}

export const authApi = {
  login(payload: LoginPayload) {
    return request<TokenResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  register(payload: RegisterPayload) {
    const formData = new FormData();
    formData.append("phone", payload.phone);
    formData.append("password", payload.password);
    formData.append("password_confirm", payload.password_confirm);
    formData.append("birth_date", payload.birth_date);
    formData.append("display_name", payload.display_name);
    formData.append("role", payload.role);
    formData.append("agree_terms", String(payload.agree_terms));
    appendImage(formData, "avatar_file", payload.avatar_file);

    return request<TokenResponse>("/api/auth/register", {
      method: "POST",
      body: formData,
    });
  },
  me(token: string) {
    return request<UserPublic>("/api/me", { method: "GET" }, token);
  },
  updateGuardian(payload: UpdateGuardianPayload, token: string) {
    return request<UserPublic>(
      "/api/me/guardian",
      {
        method: "PATCH",
        body: JSON.stringify(payload),
      },
      token
    );
  },
  /** 更换头像：multipart，字段 avatar_file */
  uploadAvatar(file: LocalImageAsset, token: string) {
    const formData = new FormData();
    formData.append(
      "avatar_file",
      {
        uri: file.uri,
        name: file.name,
        type: file.mimeType,
      } as any
    );
    return request<UserPublic>(
      "/api/me/avatar",
      { method: "POST", body: formData },
      token,
      { timeoutMs: AVATAR_UPLOAD_TIMEOUT_MS }
    );
  },
};
