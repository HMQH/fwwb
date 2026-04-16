export type ProfileMemorySnapshot = {
  source?: string | null;
  event_id?: string | null;
  event_title?: string | null;
  created_at?: string | null;
  relation_name?: string | null;
  candidate_memory?: string | null;
  memory_bucket?: string | null;
  query_tags?: string[];
  should_promote?: boolean;
  score_hit?: boolean;
  promoted_now?: boolean;
  promoted?: boolean;
  threshold_hit?: boolean;
  urgency_delta?: number;
  urgency_score_before?: number;
  urgency_score_after?: number;
  safety_score?: number;
  promotion_reason?: string | null;
  merge_reason?: string | null;
  merged_profile_summary?: string | null;
  promotion_score?: number | null;
  memory_path?: string | null;
  daily_note_path?: string | null;
};

export type ProfileMemoryHistoryItem = {
  id: string;
  source: "detection" | "assistant" | string;
  created_at: string;
  risk_level: string | null;
  fraud_type: string | null;
  summary: string | null;
  snapshot: ProfileMemorySnapshot | null;
};

export type ProfileMemoryDocument = {
  path: string;
  updated_at: string | null;
  markdown: string;
  history: ProfileMemoryHistoryItem[];
};
