import { request } from "@/shared/api";

import type { RecordDetail, RecordHistoryItem, RecordScope, RecordStatistics } from "./types";

export const recordsApi = {
  list(token: string, limit = 20, offset = 0, scope: RecordScope = "month") {
    return request<RecordHistoryItem[]>(
      `/api/detections/submissions?limit=${limit}&offset=${offset}&scope=${scope}`,
      {},
      token
    );
  },

  statistics(token: string, scope: RecordScope = "month") {
    return request<RecordStatistics>(`/api/detections/submissions/statistics?scope=${scope}`, {}, token);
  },

  detail(token: string, submissionId: string) {
    return request<RecordDetail>(`/api/detections/submissions/${submissionId}`, {}, token);
  },
};
