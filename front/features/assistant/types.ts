import type { SimilarImageItem } from "@/features/detections/types";

export type AssistantRole = "assistant" | "user" | "system";
export type AssistantAttachmentKind = "text" | "audio" | "image" | "video";

export type AssistantAttachment = {
  upload_id?: string | null;
  storage_batch_id?: string | null;
  upload_type: AssistantAttachmentKind;
  file_path: string;
  name: string;
  mime_type?: string | null;
  preview_text?: string | null;
  uri?: string | null;
};

export type AssistantDraftAttachment = {
  id: string;
  uri: string;
  name: string;
  type: string;
  kind: AssistantAttachmentKind;
};

export type AssistantSession = {
  id: string;
  user_id: string;
  relation_profile_id: string | null;
  source_submission_id: string | null;
  title: string;
  created_at: string;
  updated_at: string;
};

export type AssistantContextBudget = {
  max_tokens: number;
  used_tokens: number;
  remaining_tokens: number;
  usage_ratio: number;
  pressure_level: "low" | "watch" | "high" | "critical" | "overflow" | string;
  message_count: number;
  compressed: boolean;
  usage_source?: "estimate" | "prompt_tokens" | string;
  actual_prompt_tokens?: number | null;
  actual_completion_tokens?: number | null;
  actual_total_tokens?: number | null;
};

export type AssistantClarifyOption = {
  key: string;
  label: string;
  submit_text: string;
};

export type AssistantClarifyPayload = {
  title?: string | null;
  prompt?: string | null;
  options: AssistantClarifyOption[];
};

export type AssistantExecutionPlanItem = {
  key: string;
  label: string;
  status: "pending" | "running" | "completed" | "failed" | string;
};

export type AssistantRecordRef = {
  capability_key: string;
  label: string;
  submission_id?: string | null;
  job_id?: string | null;
  result_id?: string | null;
};

export type AssistantExecutionStep = {
  id: string;
  capability_key: string;
  title: string;
  status: "pending" | "running" | "completed" | "failed" | string;
  summary?: string | null;
  details?: string[] | null;
  gallery_items?: SimilarImageItem[] | null;
  record_refs?: AssistantRecordRef[] | null;
};

export type AssistantExecution = {
  mode?: "clarify" | "tool" | "chat" | string;
  clarify?: AssistantClarifyPayload | null;
  plan?: AssistantExecutionPlanItem[] | null;
  steps?: AssistantExecutionStep[] | null;
  record_refs?: AssistantRecordRef[] | null;
  compression?: {
    applied?: boolean;
    kept_recent?: number;
    summarized_messages?: number;
    summary?: string | null;
  } | null;
};

export type AssistantMessage = {
  id: string;
  session_id: string;
  user_id: string;
  role: AssistantRole;
  content: string;
  extra_payload: Record<string, unknown>;
  created_at: string;
  client_status?: "pending" | "streaming" | "failed";
};

export type AssistantSessionDetail = {
  session: AssistantSession;
  messages: AssistantMessage[];
};

export type AssistantConversationTurn = {
  session: AssistantSession;
  user_message: AssistantMessage;
  assistant_message: AssistantMessage;
};

export type AssistantStreamAck = {
  session: AssistantSession;
  user_message: AssistantMessage;
  assistant_message: AssistantMessage;
};

export type AssistantStreamDelta = {
  assistant_message_id: string;
  delta: string;
  phase: string;
};

export type AssistantStreamDone = {
  session: AssistantSession;
  assistant_message: AssistantMessage;
};

export type AssistantStreamContextBudget = {
  assistant_message_id: string;
  budget: AssistantContextBudget;
};

export type AssistantStreamClarify = {
  assistant_message_id: string;
  clarify: AssistantClarifyPayload;
};

export type AssistantStreamPlan = {
  assistant_message_id: string;
  items: AssistantExecutionPlanItem[];
};

export type AssistantStreamStepEvent = {
  assistant_message_id: string;
  step: AssistantExecutionStep;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function getAssistantMessageAttachments(message: AssistantMessage): AssistantAttachment[] {
  const raw = message.extra_payload?.attachments;
  if (!Array.isArray(raw)) {
    return [];
  }

  const result: AssistantAttachment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const uploadType = (item as { upload_type?: unknown }).upload_type;
    if (uploadType !== "text" && uploadType !== "audio" && uploadType !== "image" && uploadType !== "video") {
      continue;
    }

    result.push({
      upload_id: typeof (item as { upload_id?: unknown }).upload_id === "string"
        ? (item as { upload_id: string }).upload_id
        : null,
      storage_batch_id: typeof (item as { storage_batch_id?: unknown }).storage_batch_id === "string"
        ? (item as { storage_batch_id: string }).storage_batch_id
        : null,
      upload_type: uploadType,
      file_path: typeof (item as { file_path?: unknown }).file_path === "string"
        ? (item as { file_path: string }).file_path
        : "",
      name: typeof (item as { name?: unknown }).name === "string"
        ? (item as { name: string }).name
        : "附件",
      mime_type: typeof (item as { mime_type?: unknown }).mime_type === "string"
        ? (item as { mime_type: string }).mime_type
        : null,
      preview_text: typeof (item as { preview_text?: unknown }).preview_text === "string"
        ? (item as { preview_text: string }).preview_text
        : null,
      uri: typeof (item as { uri?: unknown }).uri === "string"
        ? (item as { uri: string }).uri
        : null,
    });
  }

  return result;
}

export function getAssistantExecution(message: AssistantMessage): AssistantExecution | null {
  const raw = message.extra_payload?.assistant_agent;
  if (!isObject(raw)) {
    return null;
  }
  return raw as unknown as AssistantExecution;
}

export function getAssistantContextBudget(message: AssistantMessage): AssistantContextBudget | null {
  const raw = message.extra_payload?.context_budget;
  if (!isObject(raw)) {
    return null;
  }
  if (
    typeof raw.max_tokens !== "number"
    || typeof raw.used_tokens !== "number"
    || typeof raw.remaining_tokens !== "number"
    || typeof raw.usage_ratio !== "number"
  ) {
    return null;
  }
  return raw as unknown as AssistantContextBudget;
}

export function getAssistantRecordRefs(message: AssistantMessage): AssistantRecordRef[] {
  const execution = getAssistantExecution(message);
  return Array.isArray(execution?.record_refs) ? execution.record_refs : [];
}
