import { request } from "@/shared/api";

import type {
  CreateGuardianBindingPayload,
  CreateGuardianEventsPayload,
  CreateGuardianInterventionPayload,
  GuardianBinding,
  GuardianEvent,
} from "./types";

export const guardiansApi = {
  listBindings(token: string) {
    return request<GuardianBinding[]>("/api/guardians/bindings", {}, token);
  },

  createBinding(payload: CreateGuardianBindingPayload, token: string) {
    return request<GuardianBinding>(
      "/api/guardians/bindings",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      token
    );
  },

  confirmBinding(bindingId: string, token: string) {
    return request<GuardianBinding>(
      `/api/guardians/bindings/${bindingId}/confirm`,
      { method: "POST" },
      token
    );
  },

  revokeBinding(bindingId: string, token: string) {
    return request<GuardianBinding>(
      `/api/guardians/bindings/${bindingId}/revoke`,
      { method: "POST" },
      token
    );
  },

  listEvents(token: string, limit = 20) {
    return request<GuardianEvent[]>(`/api/guardians/events?limit=${limit}`, {}, token);
  },

  createEvents(payload: CreateGuardianEventsPayload, token: string) {
    return request<GuardianEvent[]>(
      "/api/guardians/events",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      token
    );
  },

  getEvent(eventId: string, token: string) {
    return request<GuardianEvent>(`/api/guardians/events/${eventId}`, {}, token);
  },

  createIntervention(eventId: string, payload: CreateGuardianInterventionPayload, token: string) {
    return request<GuardianEvent>(
      `/api/guardians/events/${eventId}/actions`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      token
    );
  },
};
