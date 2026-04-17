export type DetectionMode = "text" | "visual" | "audio" | "mixed";

export type AudioVerifyResponse = {
  label: "genuine" | "fake" | string;
  genuine_prob: number;
  fake_prob: number;
  score: number;
  duration_sec: number;
  model_version: string;
  feature_version: string;
};

export type AudioVerifyJobSubmitResponse = {
  job_id: string;
  status: "pending" | "running" | "completed" | "failed" | string;
  created_at: string;
  filename: string | null;
};

export type AudioVerifyJobResponse = AudioVerifyJobSubmitResponse & {
  updated_at: string;
  error_message: string | null;
  result: AudioVerifyResponse | null;
};

export type AudioVerifyBatchItemResponse = {
  item_id: string;
  filename: string | null;
  status: "pending" | "running" | "completed" | "failed" | string;
  error_message: string | null;
  result: AudioVerifyResponse | null;
};

export type AudioVerifyBatchJobSubmitResponse = {
  batch_id: string;
  status: "pending" | "running" | "completed" | "failed" | string;
  created_at: string;
  total_count: number;
  items: AudioVerifyBatchItemResponse[];
};

export type AudioVerifyBatchJobResponse = AudioVerifyBatchJobSubmitResponse & {
  updated_at: string;
  completed_count: number;
  failed_count: number;
};

export type AudioVerifyRecordItem = {
  file_path?: string | null;
  file_name: string;
  status: "completed" | "failed" | string;
  error_message?: string | null;
  label?: "genuine" | "fake" | string;
  genuine_prob?: number | null;
  fake_prob?: number | null;
  score?: number | null;
  duration_sec?: number | null;
  model_version?: string | null;
  feature_version?: string | null;
};

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

export type AIFaceImageSize = {
  width: number;
  height: number;
};

export type AIFaceFaceResult = {
  face_id: number;
  bbox: [number, number, number, number] | number[];
  det_score: number;
  fake_score: number;
  label: "fake" | "real" | string;
  landmarks: Array<[number, number] | number[]>;
};

export type AIFaceCheckResponse = {
  status: string;
  message: string;
  source: string;
  prediction: "fake" | "real" | string;
  is_ai_face: boolean;
  confidence: number;
  fake_probability: number;
  real_probability?: number;
  image_fake_score?: number | null;
  raw_label?: string;
  model?: string;
  face_detector_model?: string;
  backend?: string;
  device?: string;
  threshold?: number | null;
  num_faces: number;
  image_size: AIFaceImageSize;
  faces: AIFaceFaceResult[];
  storage_batch_id?: string | null;
  stored_file_path?: string | null;
  upload_id?: string | null;
  submission_id?: string | null;
  job_id?: string | null;
  result_id?: string | null;
};

export type DetectionSubmission = {
  id: string;
  user_id: string;
  relation_profile_id: string | null;
  relation_profile_name: string | null;
  relation_profile_type: string | null;
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

export type EvidenceItem = {
  skill: string;
  title: string;
  detail: string;
  severity: string;
  source_path?: string | null;
  extra?: Record<string, unknown>;
};

export type SimilarImageItem = {
  id: string;
  title?: string | null;
  source_url?: string | null;
  image_url?: string | null;
  thumbnail_url?: string | null;
  domain?: string | null;
  provider?: string | null;
  match_type?: string | null;
  is_validated?: boolean;
  clip_similarity?: number | null;
  hash_similarity?: number | null;
  phash_distance?: number | null;
  dhash_distance?: number | null;
  hash_near_duplicate?: boolean;
  clip_high_similarity?: boolean;
};

export type DetectionQrAnalysis = {
  payload?: string | null;
  normalized_url?: string | null;
  host?: string | null;
  destination_label?: string | null;
  destination_kind?: string | null;
  local_risk_level?: string | null;
  local_model_name?: string | null;
  phish_prob?: number | null;
  clues?: string[] | null;
  risk_score?: number | null;
  risk_level?: string | null;
  summary?: string | null;
  final_reason?: string | null;
};

export type SkillHit = {
  name: string;
  status: string;
  triggered: boolean;
  risk_score: number;
  summary: string;
  labels: string[];
};

export type DetectionModuleTraceItem = {
  id?: string;
  key: string;
  action?: string;
  label: string;
  status: "pending" | "running" | "completed" | "failed" | string;
  enabled?: boolean;
  iteration?: number;
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
  execution_trace?: DetectionModuleTraceItem[];
  module_trace?: DetectionModuleTraceItem[];
  qr_analysis?: DetectionQrAnalysis | null;
  final_score?: number | null;
  llm_used?: boolean | null;
  semantic_rule_used?: boolean | null;
  semantic_rule_model?: string | null;
  risk_evidence?: string[];
  counter_evidence?: string[];
  similar_images?: SimilarImageItem[];
  similar_images_count?: number | null;
  audio_verify_items?: AudioVerifyRecordItem[];
  [key: string]: unknown;
};

export type DetectionPipelineProgressDetail = {
  status?: string;
  current_step?: string | null;
  progress_percent?: number | null;
  execution_trace?: DetectionModuleTraceItem[];
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
  status: string;
  risk_level: "low" | "medium" | "high" | string | null;
  fraud_type: string | null;
  confidence: number | null;
  is_fraud: boolean | null;
  summary: string | null;
  final_reason: string | null;
  risk_score: number | null;
  need_manual_review: boolean;
  stage_tags: string[];
  hit_rules: string[];
  rule_hits: DetectionRuleHit[];
  extracted_entities: Record<string, unknown>;
  input_highlights: Array<{ text: string; reason: string }>;
  retrieved_evidence: DetectionEvidence[];
  counter_evidence: DetectionEvidence[];
  advice: string[];
  risk_labels: string[];
  skills_triggered: SkillHit[];
  evidence: EvidenceItem[];
  recommendations: string[];
  llm_model: string | null;
  result_detail: DetectionResultDetail | Record<string, unknown> | unknown[] | null;
  created_at: string;
  updated_at: string;
};

export type DetectionGuardianEventSummary = {
  event_count: number;
  latest_event_id: string;
  latest_risk_level: string;
  latest_notify_status: "pending" | "sent" | "read" | "failed" | string;
  latest_guardian_name: string | null;
  latest_guardian_phone: string | null;
  latest_guardian_relation: "self" | "parent" | "spouse" | "child" | "relative" | null;
  latest_created_at: string;
  latest_acknowledged_at: string | null;
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
  guardian_event_summary: DetectionGuardianEventSummary | null;
  content_preview: string | null;
};

export type DetectionSubmissionDetail = DetectionHistoryItem;

export type WebPhishingRiskLevel = "safe" | "suspicious" | "medium" | "high" | string;

export type WebPhishingPredictRequest = {
  url: string;
  html?: string | null;
  return_features?: boolean;
};

export type WebPhishingPredictResponse = {
  url: string;
  mode: "url_only" | "url_html" | string;
  model_name: string;
  pred_label: number;
  is_phishing: boolean;
  phish_prob: number;
  confidence: number;
  risk_level: WebPhishingRiskLevel;
  features: Record<string, number> | null;
};
