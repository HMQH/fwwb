import type { LocalImageAsset } from "@/features/auth";
import { request } from "@/shared/api";
import { prepareImageForUpload } from "@/shared/image-cache";

import type {
  CreateMemoryPayload,
  CreateRelationPayload,
  RelationDetail,
  RelationMemory,
  RelationProfileSummary,
  UpdateMemoryScopePayload,
  UpdateRelationPayload,
} from "./types";

export const relationsApi = {
  list(token: string) {
    return request<RelationProfileSummary[]>("/api/relations", {}, token);
  },

  create(payload: CreateRelationPayload, token: string) {
    return request<RelationProfileSummary>(
      "/api/relations",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      token
    );
  },

  update(relationId: string, payload: UpdateRelationPayload, token: string) {
    return request<RelationProfileSummary>(
      `/api/relations/${relationId}`,
      {
        method: "PATCH",
        body: JSON.stringify(payload),
      },
      token
    );
  },

  async uploadAvatar(relationId: string, file: LocalImageAsset, token: string) {
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

    return request<RelationProfileSummary>(
      `/api/relations/${relationId}/avatar`,
      {
        method: "POST",
        body: formData,
      },
      token
    );
  },

  detail(relationId: string, token: string) {
    return request<RelationDetail>(`/api/relations/${relationId}`, {}, token);
  },

  createMemory(relationId: string, payload: CreateMemoryPayload, token: string) {
    return request<RelationMemory>(
      `/api/relations/${relationId}/memories`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      token
    );
  },

  updateMemoryScope(
    relationId: string,
    memoryId: string,
    payload: UpdateMemoryScopePayload,
    token: string
  ) {
    return request<RelationMemory>(
      `/api/relations/${relationId}/memories/${memoryId}`,
      {
        method: "PATCH",
        body: JSON.stringify(payload),
      },
      token
    );
  },
};
