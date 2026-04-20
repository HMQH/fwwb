import { request } from "@/shared/api";
import { prepareImageForUpload } from "@/shared/image-cache";

import type { AssignUploadPayload, UserUpload } from "./types";

type UploadImageFile = {
  uri: string;
  name: string;
  type: string;
};

const UPLOAD_TIMEOUT_MS = 60_000;

export const uploadsApi = {
  list(token: string, limit = 120) {
    return request<UserUpload[]>(`/api/uploads?limit=${limit}`, {}, token);
  },

  async uploadImage(file: UploadImageFile, token: string) {
    const prepared = await prepareImageForUpload(
      {
        uri: file.uri,
        name: file.name,
        type: file.type,
      },
      "upload"
    );

    const formData = new FormData();
    formData.append(
      "image_file",
      { uri: prepared.uri, name: prepared.name, type: prepared.type } as unknown as Blob
    );

    return request<UserUpload>(
      "/api/uploads/images",
      {
        method: "POST",
        body: formData,
      },
      token,
      { timeoutMs: UPLOAD_TIMEOUT_MS }
    );
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
