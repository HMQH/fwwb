import { request } from "@/shared/api";

import type { ProfileMemoryDocument } from "./types";

export const profileMemoryApi = {
  async get(token: string) {
    return request<ProfileMemoryDocument>("/api/profile-memory/me", {}, token);
  },
};
