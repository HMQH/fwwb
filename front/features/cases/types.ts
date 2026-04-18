export type FraudCaseFlowNode = {
  id: string;
  label: string;
  tone?: string | null;
};

export type FraudCaseMediaAsset = {
  type: string;
  url: string;
  thumbnail_url?: string | null;
};

export type FraudCaseDetailBlock = {
  title: string;
  paragraphs: string[];
};

export type FraudCaseCategoryKey =
  | "recommended"
  | "financial_fraud"
  | "social_fraud"
  | "impersonation_fraud"
  | "transaction_fraud"
  | "job_fraud"
  | "livelihood_fraud"
  | "other_fraud";

export type LearningTopicKey = Exclude<FraudCaseCategoryKey, "recommended">;

export type FraudCaseCategory = {
  key: FraudCaseCategoryKey;
  label: string;
  count: number;
};

export type FraudCaseItem = {
  id: string;
  source_name: string;
  source_domain: string;
  source_article_title: string;
  source_article_url: string;
  title: string;
  summary: string | null;
  content_type: string;
  fraud_type: string | null;
  topic_key: LearningTopicKey;
  topic_label: string;
  cover_url: string | null;
  tags: string[];
  target_roles: string[];
  warning_signs: string[];
  prevention_actions: string[];
  flow_nodes: FraudCaseFlowNode[];
  media_assets: FraudCaseMediaAsset[];
  detail_blocks: FraudCaseDetailBlock[];
  source_published_at: string | null;
  published_at: string;
  last_synced_at: string;
  is_featured: boolean;
  status: string;
  created_at: string;
  updated_at: string;
};

export type FraudCaseSyncRun = {
  id: string;
  source_name: string;
  status: string;
  discovered_count: number;
  inserted_count: number;
  updated_count: number;
  skipped_count: number;
  error_message: string | null;
  detail: Record<string, unknown>;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
};

export type FraudCaseListResponse = {
  items: FraudCaseItem[];
  page: number;
  limit: number;
  total: number;
  has_more: boolean;
  categories: FraudCaseCategory[];
  last_sync_at: string | null;
  latest_sync: FraudCaseSyncRun | null;
};

export type FraudCaseDetail = FraudCaseItem & {
  related_cases: FraudCaseItem[];
};
