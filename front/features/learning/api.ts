import type { UserRole } from "@/features/auth";
import { request } from "@/shared/api";

import type {
  LearningCaseCategoryKey,
  LearningCasesFeed,
  LearningTopicKey,
  LearningQuizSet,
  LearningSimulationReply,
  LearningSimulationResult,
  LearningSimulationSession,
  LearningTopicsOverview,
} from "./types";

export const learningApi = {
  topics(params?: { topic?: LearningTopicKey | null; role?: UserRole | null }) {
    const query = new URLSearchParams();
    if (params?.topic) {
      query.set("topic", params.topic);
    }
    if (params?.role) {
      query.set("role", params.role);
    }
    const suffix = query.toString();
    return request<LearningTopicsOverview>(`/api/learning/topics${suffix ? `?${suffix}` : ""}`);
  },

  casesFeed(params?: { category?: LearningCaseCategoryKey | null; role?: UserRole | null; limit?: number }) {
    const query = new URLSearchParams();
    if (params?.category) {
      query.set("category", params.category);
    }
    if (params?.role) {
      query.set("role", params.role);
    }
    if (params?.limit) {
      query.set("limit", String(params.limit));
    }
    const suffix = query.toString();
    return request<LearningCasesFeed>(`/api/learning/cases${suffix ? `?${suffix}` : ""}`);
  },

  quizSet(params: { topic: LearningTopicKey; count?: number; role?: UserRole | null }) {
    const query = new URLSearchParams();
    query.set("topic", params.topic);
    query.set("count", String(params.count ?? 5));
    if (params.role) {
      query.set("role", params.role);
    }
    return request<LearningQuizSet>(`/api/learning/quizzes?${query.toString()}`);
  },

  startSimulation(body: { topic_key: LearningTopicKey; user_role?: UserRole | null }) {
    return request<LearningSimulationSession>("/api/learning/simulations", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  sendSimulationReply(sessionId: string, body: { message: string }) {
    return request<LearningSimulationReply>(`/api/learning/simulations/${sessionId}/reply`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  finishSimulation(sessionId: string) {
    return request<LearningSimulationResult>(`/api/learning/simulations/${sessionId}/finish`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  },
};
