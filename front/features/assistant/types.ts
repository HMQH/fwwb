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
