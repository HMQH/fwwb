import { request } from "@/shared/api";

import type {
  GenerateGuardianReportPayload,
  GuardianReportActionStatus,
  GuardianReportType,
  GuardianSafetyReport,
} from "./types";

type ReportListParams = {
  report_type?: GuardianReportType;
  ward_user_id?: string;
  limit?: number;
  offset?: number;
};

function buildListQuery(params: ReportListParams) {
  const search = new URLSearchParams();
  if (params.report_type) {
    search.set("report_type", params.report_type);
  }
  if (params.ward_user_id) {
    search.set("ward_user_id", params.ward_user_id);
  }
  if (typeof params.limit === "number") {
    search.set("limit", String(params.limit));
  }
  if (typeof params.offset === "number") {
    search.set("offset", String(params.offset));
  }
  const raw = search.toString();
  return raw ? `?${raw}` : "";
}

export const guardianReportsApi = {
  generate(payload: GenerateGuardianReportPayload, token: string) {
    return request<GuardianSafetyReport>(
      "/api/guardians/reports/generate",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      token
    );
  },

  list(token: string, params: ReportListParams = {}) {
    return request<GuardianSafetyReport[]>(
      `/api/guardians/reports${buildListQuery(params)}`,
      {},
      token
    );
  },

  get(reportId: string, token: string) {
    return request<GuardianSafetyReport>(`/api/guardians/reports/${reportId}`, {}, token);
  },

  markRead(reportId: string, token: string) {
    return request<GuardianSafetyReport>(
      `/api/guardians/reports/${reportId}/read`,
      { method: "POST" },
      token
    );
  },

  updateActionStatus(
    reportId: string,
    actionId: string,
    status: GuardianReportActionStatus,
    token: string
  ) {
    return request<GuardianSafetyReport>(
      `/api/guardians/reports/${reportId}/actions/${actionId}`,
      {
        method: "POST",
        body: JSON.stringify({ status }),
      },
      token
    );
  },
};
