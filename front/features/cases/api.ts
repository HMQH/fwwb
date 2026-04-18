import type { UserRole } from "@/features/auth";
import { request } from "@/shared/api";

import type { FraudCaseCategoryKey, FraudCaseDetail, FraudCaseListResponse } from "./types";

export const casesApi = {
  list(params: {
    page?: number;
    limit?: number;
    category?: FraudCaseCategoryKey | null;
    role?: UserRole | null;
  }) {
    const query = new URLSearchParams();
    query.set("page", String(params.page ?? 1));
    query.set("limit", String(params.limit ?? 12));
    query.set("sort", "latest");
    if (params.category) {
      query.set("category", params.category);
    }
    if (params.role) {
      query.set("role", params.role);
    }
    return request<FraudCaseListResponse>(`/api/cases?${query.toString()}`);
  },

  detail(caseId: string) {
    return request<FraudCaseDetail>(`/api/cases/${caseId}`);
  },
};
