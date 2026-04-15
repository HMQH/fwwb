import { request } from "@/shared/api";

import type { AssignUploadPayload, UserUpload } from "./types";

export const uploadsApi = {
  list(token: string, limit = 120) {
    return request<UserUpload[]>(`/api/uploads?limit=${limit}`, {}, token);
  },

  assign(uploadId: string, payload: AssignUploadPayload, token: string) {
    return request<UserUpload>(
      `/api/uploads/${uploadId}/assign`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      token
    );
  },
};
