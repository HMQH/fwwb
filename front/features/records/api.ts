import { request } from "@/shared/api";

import type { RecordDetail, RecordHistoryItem } from "./types";

export const recordsApi = {
  list(token: string, limit = 20) {
    return request<RecordHistoryItem[]>(`/api/detections/submissions?limit=${limit}`, {}, token);
  },

  detail(token: string, submissionId: string) {
    return request<RecordDetail>(`/api/detections/submissions/${submissionId}`, {}, token);
  },
};
