import { API_BASE, ApiError, request } from "@/shared/api";

import type {
  AssistantConversationTurn,
  AssistantDraftAttachment,
  AssistantSession,
  AssistantSessionDetail,
  AssistantStreamAck,
  AssistantStreamDelta,
  AssistantStreamDone,
} from "./types";

const ASSISTANT_SEND_TIMEOUT_MS = 120_000;

type AssistantStreamHandlers = {
  onAck?: (payload: AssistantStreamAck) => void;
  onDelta?: (payload: AssistantStreamDelta) => void;
  onDone?: (payload: AssistantStreamDone) => void;
  onError?: (message: string) => void;
};

type CreateSessionInput = {
  relation_profile_id?: string | null;
  source_submission_id?: string | null;
  title?: string | null;
};

type StreamMessageInput = {
  content: string;
  attachments?: AssistantDraftAttachment[];
  relationProfileId?: string | null;
};

function parseErrorText(raw: string, fallback: string) {
  try {
    const payload = JSON.parse(raw) as { detail?: unknown };
    if (typeof payload.detail === "string") {
      return payload.detail;
    }
  } catch {
    // ignore
  }
  return fallback;
}

function dispatchSseBlock(block: string, handlers: AssistantStreamHandlers) {
  const lines = block
    .split(/\r?\n/)
    .map((item) => item.trimEnd())
    .filter(Boolean);

  if (!lines.length) {
    return;
  }

  let eventName = "message";
  const dataParts: string[] = [];
  for (const line of lines) {
    if (line.startsWith("event:")) {
      eventName = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataParts.push(line.slice(5).trim());
    }
  }

  const rawData = dataParts.join("\n").trim();
  if (!rawData || rawData === "[DONE]") {
    return;
  }

  let payload: unknown = null;
  try {
    payload = JSON.parse(rawData);
  } catch {
    return;
  }

  if (eventName === "ack") {
    handlers.onAck?.(payload as AssistantStreamAck);
    return;
  }
  if (eventName === "delta") {
    handlers.onDelta?.(payload as AssistantStreamDelta);
    return;
  }
  if (eventName === "done") {
    handlers.onDone?.(payload as AssistantStreamDone);
    return;
  }
  if (eventName === "error" && payload && typeof payload === "object" && "message" in payload) {
    const message = (payload as { message?: unknown }).message;
    if (typeof message === "string") {
      handlers.onError?.(message);
    }
  }
}

function appendRnFiles(form: FormData, fieldName: string, files: AssistantDraftAttachment[]) {
  for (const file of files) {
    form.append(
      fieldName,
      { uri: file.uri, name: file.name, type: file.type } as unknown as Blob
    );
  }
}

function buildStreamBody(input: StreamMessageInput) {
  const attachments = input.attachments ?? [];
  const content = input.content.trim();

  if (!attachments.length) {
    return JSON.stringify({
      content,
      relation_profile_id: input.relationProfileId ?? null,
    });
  }

  const form = new FormData();
  if (content) {
    form.append("content", content);
  }
  form.append("relation_profile_id", input.relationProfileId ?? "");
  appendRnFiles(form, "text_files", attachments.filter((item) => item.kind === "text"));
  appendRnFiles(form, "audio_files", attachments.filter((item) => item.kind === "audio"));
  appendRnFiles(form, "image_files", attachments.filter((item) => item.kind === "image"));
  appendRnFiles(form, "video_files", attachments.filter((item) => item.kind === "video"));
  return form;
}

export const assistantApi = {
  listSessions(token: string, limit = 20) {
    return request<AssistantSession[]>(`/api/assistant/sessions?limit=${limit}`, {}, token);
  },

  createSession(token: string, input: CreateSessionInput = {}) {
    return request<AssistantSessionDetail>(
      "/api/assistant/sessions",
      {
        method: "POST",
        body: JSON.stringify(input),
      },
      token
    );
  },

  getSession(token: string, sessionId: string) {
    return request<AssistantSessionDetail>(`/api/assistant/sessions/${sessionId}`, {}, token);
  },

  sendMessage(token: string, sessionId: string, content: string) {
    return request<AssistantConversationTurn>(
      `/api/assistant/sessions/${sessionId}/messages`,
      {
        method: "POST",
        body: JSON.stringify({ content }),
      },
      token,
      { timeoutMs: ASSISTANT_SEND_TIMEOUT_MS }
    );
  },

  streamMessage(token: string, sessionId: string, input: StreamMessageInput, handlers: AssistantStreamHandlers) {
    return new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const body = buildStreamBody(input);
      let processedLength = 0;
      let buffer = "";

      const processIncoming = (flush = false) => {
        const incoming = xhr.responseText.slice(processedLength);
        processedLength = xhr.responseText.length;
        buffer += incoming;

        const blocks = buffer.split(/\r?\n\r?\n/);
        if (!flush) {
          buffer = blocks.pop() ?? "";
        } else {
          buffer = "";
        }

        for (const block of blocks) {
          dispatchSseBlock(block, handlers);
        }
      };

      xhr.open("POST", `${API_BASE}/api/assistant/sessions/${sessionId}/messages/stream`, true);
      xhr.setRequestHeader("Accept", "text/event-stream");
      xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      if (!(body instanceof FormData)) {
        xhr.setRequestHeader("Content-Type", "application/json");
      }
      xhr.timeout = ASSISTANT_SEND_TIMEOUT_MS;

      xhr.onprogress = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          processIncoming(false);
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          processIncoming(true);
          resolve();
          return;
        }
        const message = parseErrorText(xhr.responseText, `请求失败（${xhr.status}）`);
        handlers.onError?.(message);
        reject(new ApiError(xhr.status, message, xhr.responseText));
      };

      xhr.onerror = () => {
        const message = "当前服务暂不可用，请稍后再试";
        handlers.onError?.(message);
        reject(new ApiError(0, message));
      };

      xhr.ontimeout = () => {
        const message = "请求超时，请检查网络后重试";
        handlers.onError?.(message);
        reject(new ApiError(0, message));
      };

      xhr.send(body);
    });
  },
};
