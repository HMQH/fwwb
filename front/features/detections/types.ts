export type DetectionMode = "text" | "visual" | "audio" | "mixed";

export type PickedFile = {
  uri: string;
  name: string;
  type: string;
};

export type DetectionSubmission = {
  id: string;
  user_id: string;
  storage_batch_id: string;
  has_text: boolean;
  has_audio: boolean;
  has_image: boolean;
  has_video: boolean;
  text_paths: string[];
  audio_paths: string[];
  image_paths: string[];
  video_paths: string[];
  text_content: string | null;
  created_at: string;
  updated_at: string;
};

export type DetectionRuleHit = {
  name: string;
  category: string;
  risk_points: number;
  explanation: string;
  matched_texts: string[];
  stage_tag?: string | null;
  fraud_type_hint?: string | null;
};

export type DetectionEvidence = {
  source_id: number;
  chunk_index: number;
  sample_label: string;
  fraud_type: string | null;
  data_source: string | null;
  url: string | null;
  chunk_text: string;
  similarity_score: number;
  match_source: string;
  reason: string;
};

export type DetectionResult = {
  id: string;
  submission_id: string;
  job_id: string | null;
  risk_level: "low" | "medium" | "high" | string | null;
  fraud_type: string | null;
  confidence: number | null;
  is_fraud: boolean | null;
  summary: string | null;
  final_reason: string | null;
  need_manual_review: boolean;
  stage_tags: string[];
  hit_rules: string[];
  rule_hits: DetectionRuleHit[];
  extracted_entities: Record<string, unknown>;
  input_highlights: Array<{ text: string; reason: string }>;
  retrieved_evidence: DetectionEvidence[];
  counter_evidence: DetectionEvidence[];
  advice: string[];
  llm_model: string | null;
  result_detail: Record<string, unknown> | unknown[] | null;
  created_at: string;
  updated_at: string;
};

export type DetectionJob = {
  id: string;
  submission_id: string;
  job_type: string;
  input_modality: string;
  status: "pending" | "running" | "completed" | "failed" | string;
  rule_score: number;
  retrieval_query: string | null;
  llm_model: string | null;
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
  result: DetectionResult | null;
};

export type DetectionSubmitAcceptedResponse = {
  submission: DetectionSubmission;
  job: DetectionJob;
};

export type DetectionHistoryItem = {
  submission: DetectionSubmission;
  latest_job: DetectionJob | null;
  latest_result: DetectionResult | null;
  content_preview: string | null;
};

export type DetectionSubmissionDetail = DetectionHistoryItem;
