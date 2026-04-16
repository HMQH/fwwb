import { request, API_BASE } from "@/shared/api";

import type {
  CallSession,
  CallSessionStartPayload,
  CallSessionStopPayload,
  LookupNumberPayload,
  LookupNumberResult,
} from "./types";

const SESSION_STOP_TIMEOUT_MS = 60_000;
const SESSION_DETAIL_TIMEOUT_MS = 120_000;
const RECORDING_UPLOAD_TIMEOUT_MS = 30 * 60_000;
const RETRANSCRIBE_TIMEOUT_MS = 10 * 60_000;

function buildFilePart(filePath: string) {
  const uri = filePath.startsWith("file://") ? filePath : `file://${filePath}`;
  const name = uri.split("/").pop() || "recording.wav";
  return {
    uri,
    name,
    type: "audio/wav",
  } as any;
}

export function resolveCallInterventionWsBase() {
  return API_BASE.replace(/^http/i, (value) => (value.toLowerCase() === "https" ? "wss" : "ws"));
}

export const callInterventionApi = {
  lookupNumber(payload: LookupNumberPayload, token: string) {
    return request<LookupNumberResult>(
      "/api/call-intervention/risk/lookup-number",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      token
    );
  },
  startSession(payload: CallSessionStartPayload, token: string) {
    return request<CallSession>(
      "/api/call-intervention/sessions/start",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      token
    );
  },
  stopSession(payload: CallSessionStopPayload, token: string) {
    return request<CallSession>(
      "/api/call-intervention/sessions/stop",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      token,
      { timeoutMs: SESSION_STOP_TIMEOUT_MS }
    );
  },
  listSessions(token: string) {
    return request<CallSession[]>("/api/call-intervention/sessions", { method: "GET" }, token, {
      timeoutMs: 20000,
    });
  },
  getSession(sessionId: string, token: string) {
    return request<CallSession>(
      `/api/call-intervention/sessions/${sessionId}`,
      { method: "GET" },
      token,
      { timeoutMs: SESSION_DETAIL_TIMEOUT_MS }
    );
  },
  retranscribeSession(sessionId: string, token: string) {
    return request<CallSession>(
      `/api/call-intervention/sessions/${sessionId}/retranscribe`,
      { method: "POST" },
      token,
      { timeoutMs: RETRANSCRIBE_TIMEOUT_MS }
    );
  },
  uploadRecording(sessionId: string, filePath: string, token: string) {
    const formData = new FormData();
    formData.append("audio_file", buildFilePart(filePath));
    return request<CallSession>(
      `/api/call-intervention/sessions/${sessionId}/recording`,
      {
        method: "POST",
        body: formData,
      },
      token,
      { timeoutMs: RECORDING_UPLOAD_TIMEOUT_MS }
    );
  },
};
