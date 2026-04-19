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

export type ScamInsightRiskLevel = "low" | "medium" | "high" | "critical" | string;

export type ScamBehaviorProfile = {
  urgency_score: number;
  dominance_score: number;
  command_score: number;
  victim_compliance_score: number;
  speech_pressure_score: number;
  summary: string;
};

export type ScamModalityContribution = {
  audio_behavior: number;
  semantic_content: number;
  process_dynamics: number;
};

export type ScamStageSlice = {
  id: string;
  stage: string;
  label: string;
  start_sec: number;
  end_sec: number;
  color: string;
  risk_score?: number;
  summary?: string;
  cue_tags?: string[];
};

export type ScamRiskCurvePoint = {
  time_sec: number;
  risk_score: number;
};

export type ScamTimelineMarker = {
  id: string;
  label: string;
  time_sec: number;
  description: string;
  tone: "warning" | "danger" | "peak" | "info" | string;
  stage_label?: string;
  user_meaning?: string;
};

export type ScamDynamics = {
  total_duration_sec: number;
  earliest_risk_sec: number;
  escalation_sec: number;
  peak_risk_sec: number;
  stage_sequence: ScamStageSlice[];
  risk_curve: ScamRiskCurvePoint[];
  key_moments: ScamTimelineMarker[];
};

export type ScamEvidenceSegment = {
  id: string;
  start_sec: number;
  end_sec: number;
  stage: string;
  stage_label: string;
  risk_score: number;
  transcript_excerpt: string;
  audio_tags: string[];
  semantic_tags: string[];
  explanation: string;
};

export type ScamDecision = {
  call_risk_score: number;
  risk_level: ScamInsightRiskLevel;
  confidence: number;
  summary: string;
  explanation: string;
  suggested_actions: string[];
};

export type ScamCallInsight = {
  behavior_profile: ScamBehaviorProfile;
  dynamics: ScamDynamics;
  evidence_segments: ScamEvidenceSegment[];
  decision: ScamDecision;
  modality_contrib: ScamModalityContribution;
};

export type AudioScamInsightJobSubmitResponse = {
  job_id: string;
  status: "pending" | "running" | "completed" | "failed" | string;
  created_at: string;
  filename: string | null;
};

export type AudioScamInsightJobResponse = {
  job_id: string;
  status: "pending" | "running" | "completed" | "failed" | string;
  created_at: string;
  updated_at: string;
  filename: string | null;
  error_message: string | null;
  result: ScamCallInsight | null;
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

export type VideoAIRecordItem = {
  file_path?: string | null;
  file_name: string;
  status: "completed" | "failed" | string;
  error_message?: string | null;
  encoder?: string | null;
  loss_type?: string | null;
  device?: string | null;
  frame_count?: number | null;
  second_order_mean?: number | null;
  second_order_std?: number | null;
  risk_level?: "low" | "medium" | "high" | string | null;
  is_ai_generated_suspect?: boolean | null;
  confidence?: number | null;
  pattern?: string | null;
  summary?: string | null;
  final_reason?: string | null;
  model_name?: string | null;
  thresholds?: Record<string, number> | null;
  key_time_sec?: number | null;
  explanation?: {
    top_anomalies?: Array<{
      rank?: number | null;
      key_second_order_index?: number | null;
      key_frame_index?: number | null;
      key_time_sec?: number | null;
      peak_second_order_score?: number | null;
      second_order_flow_peak_magnitude?: number | null;
      second_order_flow_mean_magnitude?: number | null;
      frame_indices?: Record<string, number> | null;
      paths?: Record<string, string> | null;
      summary?: string | null;
    }> | null;
    key_second_order_index?: number | null;
    key_frame_index?: number | null;
    key_time_sec?: number | null;
    peak_second_order_score?: number | null;
    second_order_flow_peak_magnitude?: number | null;
    second_order_flow_mean_magnitude?: number | null;
    frame_indices?: Record<string, number> | null;
    paths?: Record<string, string> | null;
    summary?: string | null;
    error?: string | null;
  } | null;
};

export type VideoSignalSeries = {
  times: number[];
  values: number[];
};

export type VideoDeceptionAnalysisFinding = {
  dimension?: string | null;
  level?: "low" | "medium" | "high" | string | null;
  title?: string | null;
  description?: string | null;
  evidence?: Record<string, unknown> | null;
};

export type VideoDeceptionTimelineEvent = {
  time_sec?: number | null;
  type?: string | null;
  severity?: "low" | "medium" | "high" | string | null;
  title?: string | null;
  description?: string | null;
  evidence?: Record<string, unknown> | null;
};

export type VideoDeceptionAnalysis = {
  overview?: string | null;
  findings?: VideoDeceptionAnalysisFinding[] | null;
  timeline_events?: VideoDeceptionTimelineEvent[] | null;
  confidence_note?: string | null;
  limitations?: string[] | null;
};

export type VideoDeceptionRecordItem = {
  file_path?: string | null;
  file_name: string;
  status: "completed" | "failed" | string;
  error_message?: string | null;
  model_name?: string | null;
  person_detected?: boolean | null;
  sampled_fps?: number | null;
  sampled_frames?: number | null;
  face_frames?: number | null;
  face_frame_ratio?: number | null;
  duration_sec?: number | null;
  confidence?: number | null;
  face_behavior_score?: number | null;
  physiology_score?: number | null;
  overall_score?: number | null;
  risk_level?: "low" | "medium" | "high" | string | null;
  signal_quality?: number | null;
  hr_mean_bpm?: number | null;
  hr_std_bpm?: number | null;
  blink_rate_per_min?: number | null;
  behavior_components?: Record<string, number> | null;
  physiology_components?: Record<string, number> | null;
  series?: {
    gaze_x?: VideoSignalSeries | null;
    gaze_y?: VideoSignalSeries | null;
    head_pitch?: VideoSignalSeries | null;
    head_yaw?: VideoSignalSeries | null;
    head_roll?: VideoSignalSeries | null;
    hr_bpm?: VideoSignalSeries | null;
    rppg_signal?: VideoSignalSeries | null;
  } | null;
  summary?: string | null;
  final_reason?: string | null;
  analysis?: VideoDeceptionAnalysis | null;
  raw?: Record<string, unknown> | null;
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
  landmarks: ([number, number] | number[])[];
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

export type DetectionKagStage = {
  code: string;
  label: string;
  score: number;
  active?: boolean;
  tone?: string | null;
};

export type DetectionKagCurrentStage = {
  code: string;
  label: string;
  score?: number | null;
  tone?: string | null;
};

export type DetectionKagEvidenceItem = {
  id: string;
  source: string;
  label: string;
  text: string;
  tone: "danger" | "safe" | "warning" | "primary" | string;
  stage?: string | null;
};

export type DetectionKagStageRow = {
  code: string;
  label: string;
  score: number;
  support_score?: number | null;
  active?: boolean;
  tone?: string | null;
  black_count?: number | null;
  white_count?: number | null;
  keywords?: string[];
};

export type DetectionKagStageRetrieval = {
  code: string;
  label: string;
  score?: number | null;
  support_score?: number | null;
  query_text?: string;
  keywords?: string[];
  black_hits?: DetectionEvidence[];
  white_hits?: DetectionEvidence[];
  black_count?: number | null;
  white_count?: number | null;
};

export type DetectionKagMetrics = {
  final_score?: number | null;
  chain_score?: number | null;
  action_score?: number | null;
  deception_score?: number | null;
  pressure_score?: number | null;
  support_score?: number | null;
  safety_score?: number | null;
  contradiction_score?: number | null;
  entity_score?: number | null;
};

export type DetectionKagDecision = {
  final_score?: number | null;
  risk_level?: string | null;
  confidence?: number | null;
  is_fraud?: boolean | null;
  need_manual_review?: boolean | null;
  summary?: string | null;
  final_reason?: string | null;
  advice?: string[];
  risk_evidence?: string[];
  counter_evidence?: string[];
};

export type DetectionReasoningStorageStage = {
  stage_code: string;
  stage_label: string;
  stage_order: number;
  score?: number | null;
  support_score?: number | null;
  is_active?: boolean;
  tone?: string | null;
  detail?: string | null;
};

export type DetectionReasoningStorageNode = {
  node_key: string;
  node_label: string;
  node_type: string;
  tone?: string | null;
  lane?: number | null;
  sort_order?: number | null;
  weight?: number | null;
  stage_code?: string | null;
  detail?: string | null;
};

export type DetectionReasoningStorageEdge = {
  edge_key: string;
  source_key: string;
  target_key: string;
  relation_type?: string | null;
  tone?: string | null;
  weight?: number | null;
  detail?: string | null;
};

export type DetectionReasoningStorageSnapshot = {
  stages?: DetectionReasoningStorageStage[];
  nodes?: DetectionReasoningStorageNode[];
  edges?: DetectionReasoningStorageEdge[];
};

export type DetectionKagPayload = {
  enabled: boolean;
  mode: "deep" | "standard" | string;
  current_stage?: DetectionKagCurrentStage | null;
  predicted_next_step?: string | null;
  trajectory?: string[];
  stage_scores?: DetectionKagStage[];
  stage_rows?: DetectionKagStageRow[];
  stage_retrievals?: DetectionKagStageRetrieval[];
  key_relations?: string[];
  intervention_focus?: string[];
  evidence_map?: DetectionKagEvidenceItem[];
  entity_count?: number | null;
  relation_count?: number | null;
  signal_count?: number | null;
  counter_signal_count?: number | null;
  metrics?: DetectionKagMetrics | null;
  merged_black_evidence?: DetectionEvidence[];
  merged_white_evidence?: DetectionEvidence[];
  decision?: DetectionKagDecision | null;
  storage_snapshot?: DetectionReasoningStorageSnapshot | null;
  reasoning_graph?: DetectionReasoningGraph | null;
  reasoning_path?: string[];
};

export type DetectionResultDetail = {
  analysis_mode?: "deep" | "standard" | string;
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
  stage_retrievals?: DetectionKagStageRetrieval[];
  storage_snapshot?: DetectionReasoningStorageSnapshot | null;
  similar_images?: SimilarImageItem[];
  similar_images_count?: number | null;
  audio_verify_items?: AudioVerifyRecordItem[];
  video_ai_items?: VideoAIRecordItem[];
  video_ai_summary?: Record<string, unknown> | null;
  video_deception_items?: VideoDeceptionRecordItem[];
  video_deception_summary?: Record<string, unknown> | null;
  kag?: DetectionKagPayload | null;
  [key: string]: unknown;
};

export type DetectionPipelineProgressDetail = {
  status?: string;
  current_step?: string | null;
  progress_percent?: number | null;
  analysis_mode?: "deep" | "standard" | string;
  deep_reasoning?: boolean;
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
  input_highlights: { text: string; reason: string }[];
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
  submission_id?: string | null;
  job_id?: string | null;
  result_id?: string | null;
};

export type DirectSkillEvidence = {
  skill: string;
  title: string;
  detail: string;
  severity: "info" | "warning" | "error" | string;
  source_path?: string | null;
  extra?: Record<string, unknown>;
};

export type DirectSkillResult = {
  name: string;
  status: string;
  summary: string;
  triggered: boolean;
  risk_score: number;
  labels: string[];
  evidence: DirectSkillEvidence[];
  recommendations: string[];
  raw: Record<string, unknown>;
};

export type DirectImageSkillCheckResponse = {
  kind: "ocr" | "official-document" | "pii" | "qr" | "impersonation" | string;
  image_name?: string | null;
  result: DirectSkillResult;
  submission_id?: string | null;
  job_id?: string | null;
  result_id?: string | null;
};
