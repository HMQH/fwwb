export type GuardianReportType = "day" | "month" | "year";
export type GuardianReportRiskLevel = "low" | "medium" | "high";
export type GuardianReportStatus = "generated" | "sent" | "read" | "archived";
export type GuardianReportLlmStatus = "success" | "fallback" | "failed";
export type GuardianReportActionType = "call" | "message" | "review" | "training" | "checklist" | "monitor";
export type GuardianReportActionPriority = "high" | "medium" | "low";
export type GuardianReportActionStatus = "pending" | "in_progress" | "completed" | "skipped";

export type GuardianReportPieSegment = {
  key: string;
  label: string;
  value: number;
  ratio: number;
  color: string;
};

export type GuardianReportLinePoint = {
  bucket_key: string;
  label: string;
  high: number;
  medium: number;
  low: number;
  total: number;
};

export type GuardianReportBarItem = {
  label: string;
  value: number;
};

export type GuardianReportAdviceItem = {
  title: string;
  detail: string;
  priority: GuardianReportActionPriority;
  action_type: GuardianReportActionType;
};

export type GuardianReportLlmReport = {
  title: string;
  summary: string;
  risk_overview: string;
  key_findings: string[];
  anomaly_notes: string[];
  actionable_advice: GuardianReportAdviceItem[];
};

export type GuardianReportEvidenceItem = {
  evidence_type: "rule_hit" | "input_highlight" | string;
  title: string;
  count: number;
  detail: string;
  samples: string[];
};

export type GuardianReportStageItem = {
  stage: string;
  count: number;
  ratio: number;
};

export type GuardianReportKeyMoment = {
  id: string;
  label: string;
  description: string;
  time_sec: number;
  tone: string;
  stage_label?: string | null;
  submission_id?: string | null;
  result_id?: string | null;
  created_at?: string | null;
};

export type GuardianReportHighRiskCase = {
  submission_id: string;
  result_id: string;
  risk_level: GuardianReportRiskLevel | string;
  fraud_type?: string | null;
  summary: string;
  final_reason?: string | null;
  confidence?: number | null;
  created_at: string;
};

export type GuardianReportPayload = {
  period?: {
    report_type: GuardianReportType | string;
    period_start: string;
    period_end: string;
    period_label: string;
  };
  metrics?: {
    total_submissions: number;
    total_results: number;
    completion_rate: number;
    high_ratio: number;
    medium_ratio: number;
    low_ratio: number;
    avg_confidence: number;
    fraud_type_count: number;
  };
  charts?: {
    pie?: GuardianReportPieSegment[];
    line?: { points: GuardianReportLinePoint[] };
    bar?: { items: GuardianReportBarItem[] };
  };
  top_evidence?: GuardianReportEvidenceItem[];
  stage_trajectory?: GuardianReportStageItem[];
  key_moments?: GuardianReportKeyMoment[];
  high_risk_cases?: GuardianReportHighRiskCase[];
  llm_report?: GuardianReportLlmReport;
};

export type GuardianReportReceipt = {
  id: string;
  report_id: string;
  guardian_binding_id: string;
  guardian_user_id: string | null;
  guardian_name: string | null;
  guardian_phone: string | null;
  delivery_channel: "inapp" | "push" | "sms" | "manual";
  delivery_status: "pending" | "sent" | "read" | "failed";
  sent_at: string | null;
  read_at: string | null;
  created_at: string;
  updated_at: string;
};

export type GuardianReportAction = {
  id: string;
  report_id: string;
  action_key: string;
  action_label: string;
  action_detail: string | null;
  action_type: GuardianReportActionType;
  priority: GuardianReportActionPriority;
  status: GuardianReportActionStatus;
  due_at: string | null;
  completed_at: string | null;
  assignee_user_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type GuardianSafetyReport = {
  id: string;
  ward_user_id: string;
  ward_display_name: string | null;
  ward_phone: string | null;
  creator_user_id: string | null;
  report_type: GuardianReportType | string;
  period_start: string;
  period_end: string;
  period_label: string;
  overall_risk_level: GuardianReportRiskLevel | string;
  overall_risk_score: number;
  total_submissions: number;
  total_results: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  status: GuardianReportStatus | string;
  llm_model: string | null;
  llm_status: GuardianReportLlmStatus | string;
  llm_title: string | null;
  llm_summary: string | null;
  payload: GuardianReportPayload | Record<string, unknown>;
  raw_aggregates: Record<string, unknown>;
  read_at: string | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
  is_read: boolean;
  receipts: GuardianReportReceipt[];
  actions: GuardianReportAction[];
};

export type GenerateGuardianReportPayload = {
  report_type: GuardianReportType;
  ward_user_id?: string;
  target_date?: string;
  force_regenerate?: boolean;
};
