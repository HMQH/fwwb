export type RelationType = "family" | "friend" | "classmate" | "stranger" | "colleague";
export type MemoryScope = "short_term" | "long_term";
export type MemoryKind = "upload" | "chat" | "note" | "summary";

export type RelationProfileSummary = {
  id: string;
  user_id: string;
  relation_type: RelationType;
  name: string;
  description: string | null;
  tags: string[];
  avatar_color: string | null;
  avatar_url: string | null;
  short_term_count: number;
  long_term_count: number;
  linked_upload_count: number;
  bound_file_count: number;
  created_at: string;
  updated_at: string;
};

export type RelationMemory = {
  id: string;
  relation_profile_id: string;
  memory_scope: MemoryScope;
  memory_kind: MemoryKind;
  title: string;
  content: string;
  extra_payload: Record<string, unknown>;
  source_submission_id: string | null;
  source_upload_id: string | null;
  happened_at: string | null;
  created_at: string;
  updated_at: string;
};

export type RelationLinkedUpload = {
  user_upload_id: string;
  upload_type: "text" | "audio" | "image" | "video" | string;
  storage_batch_id: string;
  file_paths: string[];
  file_count: number;
  source_submission_id: string | null;
  created_at: string;
  updated_at: string;
};

export type RelationDetail = {
  profile: RelationProfileSummary;
  short_term_memories: RelationMemory[];
  long_term_memories: RelationMemory[];
  linked_uploads: RelationLinkedUpload[];
};

export type CreateRelationPayload = {
  relation_type: RelationType;
  name: string;
  description?: string;
  tags?: string[];
};

export type UpdateRelationPayload = Partial<CreateRelationPayload>;

export type CreateMemoryPayload = {
  memory_scope: MemoryScope;
  memory_kind?: MemoryKind;
  title: string;
  content: string;
};

export type UpdateMemoryScopePayload = {
  memory_scope: MemoryScope;
};

export const relationTypeMeta: Record<
  RelationType,
  {
    label: string;
    icon: string;
    accent: string;
    soft: string;
  }
> = {
  family: {
    label: "亲友",
    icon: "account-heart-outline",
    accent: "#3E74F7",
    soft: "rgba(62, 116, 247, 0.12)",
  },
  friend: {
    label: "朋友",
    icon: "account-group-outline",
    accent: "#2794F1",
    soft: "rgba(39, 148, 241, 0.12)",
  },
  classmate: {
    label: "同学",
    icon: "school-outline",
    accent: "#5F70FF",
    soft: "rgba(95, 112, 255, 0.12)",
  },
  stranger: {
    label: "陌生人",
    icon: "account-question-outline",
    accent: "#8B61FF",
    soft: "rgba(139, 97, 255, 0.12)",
  },
  colleague: {
    label: "同事",
    icon: "briefcase-account-outline",
    accent: "#2A93CA",
    soft: "rgba(42, 147, 202, 0.12)",
  },
};

export const memoryScopeMeta: Record<MemoryScope, { label: string }> = {
  short_term: { label: "短期" },
  long_term: { label: "长期" },
};
