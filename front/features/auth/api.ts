import { request } from "@/shared/api";
import { prepareImageForUpload } from "@/shared/image-cache";
import type {
  LoginPayload,
  LocalImageAsset,
  PushTokenResponse,
  RegisterPushTokenPayload,
  RegisterPayload,
  TokenResponse,
  UpdateGuardianPayload,
  UserPublic,
} from "./types";

const AVATAR_UPLOAD_TIMEOUT_MS = 60_000;

async function appendImage(formData: FormData, key: string, file: LocalImageAsset | null | undefined) {
  if (!file) {
    return;
  }

  const prepared = await prepareImageForUpload(
    {
      uri: file.uri,
      name: file.name,
      mimeType: file.mimeType,
    },
    "avatar"
  );

  formData.append(
    key,
    {
      uri: prepared.uri,
      name: prepared.name,
      type: prepared.mimeType,
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
  async register(payload: RegisterPayload) {
    const formData = new FormData();
    formData.append("phone", payload.phone);
    formData.append("password", payload.password);
    formData.append("password_confirm", payload.password_confirm);
    formData.append("birth_date", payload.birth_date);
    formData.append("display_name", payload.display_name);
    formData.append("role", payload.role);
    formData.append("agree_terms", String(payload.agree_terms));
    await appendImage(formData, "avatar_file", payload.avatar_file);

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
  registerPushToken(payload: RegisterPushTokenPayload, token: string) {
    return request<PushTokenResponse>(
      "/api/me/push-token",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      token
    );
  },
  /** 更换头像：multipart，字段 avatar_file */
  async uploadAvatar(file: LocalImageAsset, token: string) {
    const prepared = await prepareImageForUpload(
      {
        uri: file.uri,
        name: file.name,
        mimeType: file.mimeType,
      },
      "avatar"
    );

    const formData = new FormData();
    formData.append(
      "avatar_file",
      {
        uri: prepared.uri,
        name: prepared.name,
        type: prepared.mimeType,
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
