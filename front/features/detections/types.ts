export type DetectionMode = "text" | "visual" | "audio" | "mixed";

export type KnownDetectionPipelineStep =
  | "queued"
  | "preprocess"
  | "embedding"
  | "vector_retrieval"
  | "graph_reasoning"
  | "llm_reasoning"
  | "finalize";

export type DetectionPipelineStep = KnownDetectionPipelineStep | string;

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

export type DetectionModuleTraceItem = {
  key: string;
  label: string;
  status: "pending" | "running" | "completed" | "failed" | string;
  enabled?: boolean;
  metrics?: Record<string, number | string | null>;
  [key: string]: unknown;
};

export type DetectionGraphNode = {
  id: string;
  label: string;
  kind: string;
  tone?: string | null;
  lane?: number | null;
  order?: number | null;
  strength?: number | null;
  meta?: Record<string, unknown> | null;
  [key: string]: unknown;
};

export type DetectionGraphEdge = {
  id: string;
  source: string;
  target: string;
  tone?: string | null;
  kind?: string | null;
  weight?: number | null;
  [key: string]: unknown;
};

export type DetectionReasoningGraph = {
  nodes: DetectionGraphNode[];
  edges: DetectionGraphEdge[];
  highlighted_path?: string[];
  highlighted_labels?: string[];
  lane_labels?: string[];
  summary_metrics?: Record<string, number | string | null>;
  [key: string]: unknown;
};

export type DetectionResultDetail = {
  reasoning_graph?: DetectionReasoningGraph | null;
  reasoning_path?: string[];
  used_modules?: string[];
  module_trace?: DetectionModuleTraceItem[];
  final_score?: number | null;
  llm_used?: boolean | null;
  semantic_rule_used?: boolean | null;
  semantic_rule_model?: string | null;
  risk_evidence?: string[];
  counter_evidence?: string[];
  [key: string]: unknown;
};

export type DetectionPipelineProgressDetail = {
  status?: string;
  current_step?: string | null;
  progress_percent?: number | null;
  module_trace?: DetectionModuleTraceItem[];
  reasoning_graph?: DetectionReasoningGraph | null;
  reasoning_path?: string[];
  used_modules?: string[];
  final_score?: number | null;
  error?: string | null;
  [key: string]: unknown;
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
  result_detail: DetectionResultDetail | Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export type DetectionJob = {
  id: string;
  submission_id: string;
  job_type: string;
  input_modality: string;
  status: "pending" | "running" | "completed" | "failed" | string;
  current_step: DetectionPipelineStep | null;
  progress_percent: number;
  progress_detail: DetectionPipelineProgressDetail | Record<string, unknown> | null;
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
