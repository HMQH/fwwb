export type LearningTopicKey =
  | "financial_fraud"
  | "social_fraud"
  | "impersonation_fraud"
  | "transaction_fraud"
  | "job_fraud"
  | "livelihood_fraud"
  | "other_fraud";

export type LearningCaseCategoryKey = LearningTopicKey | "recommended";

export type LearningTopicSummary = {
  key: LearningTopicKey;
  label: string;
  description: string;
  simulation_persona: string;
  count: number;
  quiz_count: number;
};

export type LearningTopicsOverview = {
  topics: LearningTopicSummary[];
  current_topic: LearningTopicSummary;
};

export type LearningCaseCategory = {
  key: LearningCaseCategoryKey;
  label: string;
  count: number;
};

export type LearningCaseFeedItem = {
  id: string;
  title: string;
  summary: string | null;
  source_name: string;
  fraud_type: string | null;
  topic_key: LearningTopicKey;
  topic_label: string;
  cover_url: string | null;
  tags: string[];
  source_article_url: string;
  source_published_at: string | null;
  published_at: string;
};

export type LearningCasesFeed = {
  categories: LearningCaseCategory[];
  current_category: LearningCaseCategoryKey;
  total: number;
  last_sync_at: string | null;
  items: LearningCaseFeedItem[];
};

export type LearningQuizOption = {
  id: string;
  text: string;
};

export type LearningQuizQuestion = {
  id: string;
  type: string;
  topic_key: LearningTopicKey;
  topic_label: string;
  stem: string;
  options: LearningQuizOption[];
  answer_id: string;
  explanation: string;
  source_case_id: string | null;
  source_case_title: string | null;
};

export type LearningQuizSet = {
  topic_key: LearningTopicKey;
  topic_label: string;
  generated_at: string;
  questions: LearningQuizQuestion[];
};

export type LearningSimulationMessage = {
  role: "assistant" | "user";
  content: string;
  created_at: string;
};

export type LearningSimulationScenario = {
  title: string;
  summary: string;
  channel: string;
  hook: string;
  tags: string[];
  source_case_id: string | null;
  source_case_title: string | null;
};

export type LearningSimulationSession = {
  session_id: string;
  topic_key: LearningTopicKey;
  topic_label: string;
  persona_label: string;
  created_at: string;
  scenario: LearningSimulationScenario;
  messages: LearningSimulationMessage[];
};

export type LearningSimulationReply = {
  session_id: string;
  assistant_message: LearningSimulationMessage;
};

export type LearningSimulationDimension = {
  key: string;
  label: string;
  score: number;
};

export type LearningSimulationRelatedCase = {
  id: string;
  title: string;
  summary: string | null;
  source_name: string;
  fraud_type: string | null;
  topic_key: LearningTopicKey;
  topic_label: string;
  source_article_url: string;
  source_published_at: string | null;
  published_at: string;
};

export type LearningSimulationResult = {
  session_id: string;
  topic_key: LearningTopicKey;
  topic_label: string;
  total_score: number;
  summary: string;
  suggestions: string[];
  dimensions: LearningSimulationDimension[];
  related_cases: LearningSimulationRelatedCase[];
};
