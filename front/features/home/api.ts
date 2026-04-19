import { request } from "@/shared/api";

export type WateringRewardSource = "quiz" | "guardian" | "case";

export type WateringRewardEvent = {
  id: string;
  source: WateringRewardSource;
  units: number;
  created_at: string;
};

export type WateringStatus = {
  water_total: number;
  pending_count: number;
  pending_units: number;
};

export type WateringRewardGrantPayload = {
  source: WateringRewardSource;
  units?: number;
  dedupe_key?: string | null;
  payload?: Record<string, unknown> | null;
};

export type WateringRewardGrantResponse = {
  created: boolean;
  event: WateringRewardEvent;
  pending_count: number;
  pending_units: number;
};

export type WateringRewardClaimResponse = {
  events: WateringRewardEvent[];
  claimed_units: number;
  water_total: number;
  pending_count: number;
  pending_units: number;
};

export const homeApi = {
  getWateringStatus(token: string) {
    return request<WateringStatus>("/api/home/watering/status", { method: "GET" }, token);
  },
  grantWateringReward(payload: WateringRewardGrantPayload, token: string) {
    return request<WateringRewardGrantResponse>(
      "/api/home/watering/rewards",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      token
    );
  },
  claimWateringRewards(token: string, limit = 64) {
    return request<WateringRewardClaimResponse>(
      "/api/home/watering/claim",
      {
        method: "POST",
        body: JSON.stringify({ limit }),
      },
      token
    );
  },
};
