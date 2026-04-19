import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";

import {
  formatRiskScore,
  getResultRiskScore,
  localizeFraudType,
  localizePiiType,
  localizeRiskLevel,
  sanitizeDisplayText,
} from "../displayText";
import type { DetectionJob, DetectionResult, DetectionResultDetail } from "../types";
import { getProgressDetail, getResultDetail } from "../visualization";

type AgentTimelineItem = {
  id: string;
  action: string;
  label: string;
  status: string;
  summary: string;
  detailLine?: string | null;
  tags: string[];
  metrics: Array<{ label: string; value: string | number }>;
};

type AgentMetric = {
  label: string;
  value: string | number;
};

type NormalizedTraceItem = {
  id: string;
  action: string;
  key: string;
  label: string;
  status: string;
  iteration?: number;
  summary?: string;
  detailLine?: string | null;
  tags?: string[];
  metrics?: AgentMetric[];
};

const ACTION_META: Record<
  string,
  {
    label: string;
    icon: keyof typeof MaterialCommunityIcons.glyphMap;
    soft: string;
    tone: string;
  }
> = {
  planner: {
    label: "任务规划",
    icon: "source-branch",
    soft: "#EAF2FF",
    tone: palette.accentStrong,
  },
  preprocess: {
    label: "清洗准备",
    icon: "tune-variant",
    soft: "#EEF5FF",
    tone: palette.accentStrong,
  },
  embedding: {
    label: "向量编码",
    icon: "barcode-scan",
    soft: "#EAF2FF",
    tone: palette.accentStrong,
  },
  graph_reasoning: {
    label: "图谱分析",
    icon: "graph-outline",
    soft: "#F3EEFF",
    tone: "#8A63D2",
  },
  finalize: {
    label: "结果收束",
    icon: "check-decagram-outline",
    soft: "#E9FAF4",
    tone: "#2E9D7F",
  },
  video_ai_detection: {
    label: "AI视频检测",
    icon: "movie-open-play-outline",
    soft: "#EEF5FF",
    tone: palette.accentStrong,
  },
  video_physiology_judgement: {
    label: "人物生理特征判断",
    icon: "account-heart-outline",
    soft: "#FFF4E8",
    tone: "#D96A4A",
  },
  followup_router: {
    label: "继续复核",
    icon: "source-branch",
    soft: "#EEF0FF",
    tone: "#6A78F5",
  },
  qr_inspector: {
    label: "二维码检查",
    icon: "qrcode-scan",
    soft: "#FFF2EA",
    tone: "#D96A4A",
  },
  ocr_phishing: {
    label: "文字提取",
    icon: "text-box-search-outline",
    soft: "#EEF0FF",
    tone: "#6A78F5",
  },
  official_document_checker: {
    label: "公文仿冒检查",
    icon: "file-document-outline",
    soft: "#F3EEFF",
    tone: "#7E67F4",
  },
  pii_guard: {
    label: "敏感信息检查",
    icon: "shield-lock-outline",
    soft: "#EAF8F1",
    tone: "#218A4A",
  },
  impersonation_checker: {
    label: "盗图冒充检查",
    icon: "account-search-outline",
    soft: "#FFF3EE",
    tone: "#C1664A",
  },
  text_rag_skill: {
    label: "文本语义检测",
    icon: "message-text-outline",
    soft: "#EAF2FF",
    tone: palette.accentStrong,
  },
  image_similarity_verifier: {
    label: "相似图复核",
    icon: "image-search-outline",
    soft: "#FFF7E8",
    tone: "#C48A29",
  },
  document_review: {
    label: "文书复核",
    icon: "file-check-outline",
    soft: "#EDF6FF",
    tone: palette.accentStrong,
  },
  conflict_resolver: {
    label: "冲突复核",
    icon: "compare",
    soft: "#F3EEFF",
    tone: "#8A63D2",
  },
  final_judge: {
    label: "最终判定",
    icon: "shield-check-outline",
    soft: "#E9FAF4",
    tone: "#2E9D7F",
  },
};

const GENERIC_PIPELINE_ACTIONS = new Set([
  "preprocess",
  "embedding",
  "vector_retrieval",
  "graph_reasoning",
  "llm_reasoning",
  "finalize",
]);

const BRANCH_KEY_MAP: Record<string, string> = {
  qr_inspector: "qr_result",
  ocr_phishing: "ocr_result",
  official_document_checker: "official_document_result",
  pii_guard: "pii_result",
  impersonation_checker: "impersonation_result",
  text_rag_skill: "text_rag_result",
  image_similarity_verifier: "image_similarity_result",
  document_review: "document_review_result",
  conflict_resolver: "conflict_resolution_result",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toFiniteNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toPercent(value: unknown) {
  const parsed = toFiniteNumber(value);
  if (parsed === null) {
    return null;
  }
  const normalized = parsed >= 0 && parsed <= 1 ? parsed * 100 : parsed;
  return Math.max(0, Math.min(100, Math.round(normalized)));
}

function getStatusLabel(status?: string | null) {
  if (status === "completed") {
    return "已完成";
  }
  if (status === "skipped") {
    return "已跳过";
  }
  if (status === "failed") {
    return "失败";
  }
  if (status === "running") {
    return "进行中";
  }
  return "待执行";
}

function addTag(target: string[], value?: string | null) {
  const text = sanitizeDisplayText(String(value ?? "").trim());
  if (!text || target.includes(text)) {
    return;
  }
  target.push(text);
}

function truncateText(value?: string | null, maxLength = 72) {
  const text = sanitizeDisplayText(value).trim();
  if (!text) {
    return "";
  }
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

function getCompactEvidenceTexts(branch: Record<string, unknown> | null, maxItems = 2) {
  const items = Array.isArray(branch?.evidence) ? branch.evidence : [];
  return items
    .filter(isRecord)
    .flatMap((item) => [
      truncateText(typeof item.title === "string" ? item.title : "", 28),
      truncateText(typeof item.detail === "string" ? item.detail : "", 40),
    ])
    .filter(Boolean)
    .slice(0, maxItems);
}

function getCompactTextList(items: Array<string | null | undefined>, maxItems = 2) {
  return items
    .map((item) => truncateText(item, 28))
    .filter(Boolean)
    .slice(0, maxItems)
    .join(" · ");
}

function getBranch(detail: DetectionResultDetail | null, action: string) {
  if (!detail) {
    return null;
  }
  const branchKey = BRANCH_KEY_MAP[action];
  if (!branchKey) {
    return null;
  }
  const directValue = detail[branchKey];
  if (isRecord(directValue)) {
    return directValue;
  }
  const branches = isRecord(detail.branches) ? detail.branches : null;
  const branchValue = branches?.[branchKey];
  return isRecord(branchValue) ? branchValue : null;
}

function normalizeTraceMetrics(metrics: unknown): AgentMetric[] {
  if (Array.isArray(metrics)) {
    return metrics
      .filter(isRecord)
      .map((item) => {
        const label = sanitizeDisplayText(String(item.label ?? "").trim());
        const value = item.value;
        if (!label || (typeof value !== "string" && typeof value !== "number")) {
          return null;
        }
        return { label, value };
      })
      .filter((item): item is AgentMetric => Boolean(item))
      .slice(0, 4);
  }

  if (!isRecord(metrics)) {
    return [];
  }

  return Object.entries(metrics)
    .map(([label, value]) => {
      const normalizedLabel = sanitizeDisplayText(label.trim());
      if (!normalizedLabel || (typeof value !== "string" && typeof value !== "number")) {
        return null;
      }
      return { label: normalizedLabel, value };
    })
    .filter((item): item is AgentMetric => Boolean(item))
    .slice(0, 4);
}

function normalizeTraceTags(tags: unknown) {
  if (!Array.isArray(tags)) {
    return [];
  }
  return tags
    .map((item) => sanitizeDisplayText(String(item ?? "").trim()))
    .filter(Boolean)
    .slice(0, 4);
}

function getVideoAiSummary(detail: DetectionResultDetail | null) {
  return isRecord(detail?.video_ai_summary) ? detail.video_ai_summary : null;
}

function getVideoPhysiologySummary(detail: DetectionResultDetail | null) {
  return isRecord(detail?.video_deception_summary) ? detail.video_deception_summary : null;
}

function getVideoAiLead(detail: DetectionResultDetail | null) {
  const summary = getVideoAiSummary(detail);
  if (isRecord(summary?.lead_item)) {
    return summary.lead_item;
  }
  const items = Array.isArray(detail?.video_ai_items) ? detail.video_ai_items.filter(isRecord) : [];
  return items[0] ?? null;
}

function getVideoPhysiologyLead(detail: DetectionResultDetail | null) {
  const summary = getVideoPhysiologySummary(detail);
  if (isRecord(summary?.lead_item)) {
    return summary.lead_item;
  }
  const items = Array.isArray(detail?.video_deception_items) ? detail.video_deception_items.filter(isRecord) : [];
  return items[0] ?? null;
}

function getVideoRiskTag(level?: string | null) {
  switch (String(level ?? "").trim().toLowerCase()) {
    case "high":
      return "高风险";
    case "medium":
      return "建议复核";
    case "low":
      return "风险较低";
    default:
      return null;
  }
}

function isLegacyGenericPipelineTrace(trace: NormalizedTraceItem[]) {
  if (!trace.length) {
    return false;
  }
  return trace.every((item) => GENERIC_PIPELINE_ACTIONS.has(item.action));
}

function getPreferredTrace(
  job: DetectionJob | null | undefined,
  resultDetail: DetectionResultDetail | null,
  progressDetail: DetectionResultDetail | null,
) {
  const resultUsedModules = Array.isArray(resultDetail?.used_modules)
    ? resultDetail.used_modules.map((item) => String(item))
    : [];
  const progressUsedModules = Array.isArray(progressDetail?.used_modules)
    ? progressDetail.used_modules.map((item) => String(item))
    : [];
  const isAgentMode = Boolean(
    job?.job_type === "agent_multimodal"
      || resultUsedModules.includes("planner")
      || progressUsedModules.includes("planner")
      || Array.isArray(resultDetail?.selected_skills)
      || Array.isArray(progressDetail?.selected_skills)
      || typeof resultDetail?.reasoning_goal === "string"
      || typeof progressDetail?.reasoning_goal === "string",
  );

  const candidates = [
    normalizeTraceItems(resultDetail?.execution_trace),
    normalizeTraceItems(resultDetail?.module_trace),
    normalizeTraceItems(progressDetail?.execution_trace),
    normalizeTraceItems(progressDetail?.module_trace),
  ];

  for (const trace of candidates) {
    if (!trace.length) {
      continue;
    }
    if (isAgentMode && isLegacyGenericPipelineTrace(trace)) {
      continue;
    }
    return trace;
  }

  return [];
}

function summarizePlanner(detail: DetectionResultDetail | null, executedCount: number) {
  const reasoningGoal = typeof detail?.reasoning_goal === "string" ? detail.reasoning_goal.trim() : "";
  if (reasoningGoal) {
    return reasoningGoal;
  }
  if (executedCount > 0) {
    return `已根据当前材料规划并执行 ${executedCount} 个步骤。`;
  }
  return "已根据当前材料生成执行顺序。";
}

function summarizeFollowupRouter(detail: DetectionResultDetail | null) {
  const agentLoop = isRecord(detail?.agent_loop) ? detail.agent_loop : null;
  const followupActions = Array.isArray(agentLoop?.followup_actions)
    ? agentLoop.followup_actions.map((item) => String(item)).filter(Boolean)
    : [];
  if (followupActions.length) {
    return `初轮综合后追加 ${followupActions.length} 个复核步骤，继续补强证据。`;
  }
  return "初轮综合后继续补充复核步骤。";
}

function summarizeQr(detail: DetectionResultDetail | null, branch: Record<string, unknown> | null) {
  const qrAnalysis = isRecord(detail?.qr_analysis) ? detail.qr_analysis : null;
  if (typeof qrAnalysis?.summary === "string" && qrAnalysis.summary.trim()) {
    return qrAnalysis.summary.trim();
  }
  if (branch?.triggered) {
    return "已识别二维码并完成去向核验。";
  }
  return "未发现可分析的二维码。";
}

function summarizeOcr(branch: Record<string, unknown> | null) {
  const raw = isRecord(branch?.raw) ? branch.raw : null;
  const text = typeof raw?.aggregated_text === "string" ? raw.aggregated_text.trim() : "";
  if (!text) {
    return "未提取到可用图中文字。";
  }
  if (branch?.triggered) {
    return "已提取图片文字，并发现诱导或钓鱼式表达。";
  }
  return "已提取图片文字，未发现明显诱导词。";
}

function summarizeOfficialDoc(branch: Record<string, unknown> | null) {
  const risk = toPercent(branch?.risk_score);
  if (risk !== null && risk >= 70) {
    return "已完成公文仿冒检查，发现较强伪造线索。";
  }
  if (risk !== null && risk >= 35) {
    return "已完成公文仿冒检查，存在一定可疑特征。";
  }
  return "已完成公文仿冒检查，暂未发现强风险特征。";
}

function summarizePii(branch: Record<string, unknown> | null) {
  const raw = isRecord(branch?.raw) ? branch.raw : null;
  const hits = Array.isArray(raw?.hits) ? raw.hits.length : 0;
  if (hits > 0) {
    return `已发现 ${hits} 处敏感信息暴露线索。`;
  }
  return "已完成敏感信息检查，未见明显泄露。";
}

function summarizeImpersonation(detail: DetectionResultDetail | null, branch: Record<string, unknown> | null) {
  const raw = isRecord(branch?.raw) ? branch.raw : null;
  const matches = Array.isArray(raw?.matches) ? raw.matches.length : 0;
  const similarCount = toFiniteNumber(detail?.similar_images_count) ?? 0;
  const validation = isRecord(raw?.similarity_validation) ? raw.similarity_validation : null;
  const validationSummary = isRecord(validation?.summary) ? validation.summary : null;
  const validatedCount = toFiniteNumber(validationSummary?.validated_match_count) ?? 0;

  if (validatedCount > 0) {
    return `已完成盗图冒充检查，确认 ${validatedCount} 个高相似公开来源。`;
  }
  if (similarCount > 0 || matches > 0) {
    return `已完成盗图冒充检查，发现 ${Math.max(similarCount, matches)} 个公开来源候选。`;
  }
  return "已完成盗图冒充检查，未发现明显公开相似图。";
}

function summarizeTextRag(branch: Record<string, unknown> | null) {
  const raw = isRecord(branch?.raw) ? branch.raw : null;
  const inputMeta = isRecord(raw?.input_meta) ? raw.input_meta : null;
  const sources = Array.isArray(inputMeta?.sources) ? inputMeta.sources.map((item) => String(item)) : [];
  if (sources.includes("submission_text") && sources.includes("ocr_text")) {
    return "已合并用户文本与图中文字，完成语义判定。";
  }
  if (sources.includes("ocr_text")) {
    return "已基于图中文字完成语义判定。";
  }
  if (sources.includes("submission_text")) {
    return "已基于提交文本完成语义判定。";
  }
  return "已完成文本语义判定。";
}

function summarizeImageVerifier(branch: Record<string, unknown> | null) {
  const raw = isRecord(branch?.raw) ? branch.raw : null;
  const validation = isRecord(raw?.validation) ? raw.validation : null;
  const summary = isRecord(validation?.summary) ? validation.summary : null;
  const validatedCount = toFiniteNumber(summary?.validated_match_count) ?? 0;
  if (validatedCount > 0) {
    return `已完成本地相似度复核，确认 ${validatedCount} 个高相似候选。`;
  }
  return "已完成本地相似度复核，未确认强匹配。";
}

function summarizeDocumentReview(branch: Record<string, unknown> | null) {
  const risk = toPercent(branch?.risk_score);
  if (risk !== null && risk >= 70) {
    return "已完成文书二次复核，伪造线索较强。";
  }
  if (risk !== null && risk >= 35) {
    return "已完成文书二次复核，存在一定伪造可能。";
  }
  return "已完成文书二次复核，风险有限。";
}

function summarizeConflict(branch: Record<string, unknown> | null) {
  if (branch?.triggered) {
    return "已复核文本与图像分支差异，并按更保守结论收束。";
  }
  return "已复核文本与图像分支，未发现明显冲突。";
}

function summarizeFinalJudge(result: DetectionResult | null) {
  if (typeof result?.summary === "string" && result.summary.trim()) {
    return sanitizeDisplayText(result.summary.trim());
  }
  return "已汇总各步骤输出并生成最终结论。";
}

function summarizeGenericPipeline(action: string) {
  switch (action) {
    case "preprocess":
      return "已完成输入材料清洗、校验与任务准备。";
    case "embedding":
      return "已提取本次检测所需的核心特征表示。";
    case "graph_reasoning":
      return "已综合当前线索执行分析与结果融合。";
    case "finalize":
      return "已收束本次检测输出并整理展示结果。";
    default:
      return "已执行当前步骤。";
  }
}

function summarizeVideoAiDetection(detail: DetectionResultDetail | null) {
  const summary = getVideoAiSummary(detail);
  const overallSummary = typeof summary?.overall_summary === "string" ? summary.overall_summary.trim() : "";
  if (overallSummary) {
    return overallSummary;
  }
  const lead = getVideoAiLead(detail);
  if (isRecord(lead)) {
    const fileName = sanitizeDisplayText(String(lead.file_name ?? "").trim());
    const riskLevel = String(lead.risk_level ?? "").trim().toLowerCase();
    if (fileName && riskLevel === "high") {
      return `${fileName} 的时序异常明显，疑似 AI 生成或强篡改。`;
    }
    if (fileName && riskLevel === "medium") {
      return `${fileName} 的时序波动偏离真实区间，建议进一步复核。`;
    }
  }
  return "已完成 AI 视频检测。";
}

function summarizeVideoPhysiologyJudgement(detail: DetectionResultDetail | null) {
  const summary = getVideoPhysiologySummary(detail);
  const overallSummary = typeof summary?.overall_summary === "string" ? summary.overall_summary.trim() : "";
  if (overallSummary) {
    return overallSummary;
  }
  const personDetectedCount = toFiniteNumber(summary?.person_detected_count) ?? 0;
  const analyzedCount = toFiniteNumber(summary?.analyzed_count) ?? 0;
  if (personDetectedCount <= 0 && analyzedCount <= 0) {
    return "未检测到稳定人物，已跳过人物生理特征判断。";
  }
  return "已完成人物生理特征判断。";
}

function buildSummary(action: string, detail: DetectionResultDetail | null, result: DetectionResult | null, branch: Record<string, unknown> | null, executedCount: number) {
  switch (action) {
    case "planner":
      return summarizePlanner(detail, executedCount);
    case "preprocess":
    case "embedding":
    case "graph_reasoning":
    case "finalize":
      return summarizeGenericPipeline(action);
    case "video_ai_detection":
      return summarizeVideoAiDetection(detail);
    case "video_physiology_judgement":
      return summarizeVideoPhysiologyJudgement(detail);
    case "followup_router":
      return summarizeFollowupRouter(detail);
    case "qr_inspector":
      return summarizeQr(detail, branch);
    case "ocr_phishing":
      return summarizeOcr(branch);
    case "official_document_checker":
      return summarizeOfficialDoc(branch);
    case "pii_guard":
      return summarizePii(branch);
    case "impersonation_checker":
      return summarizeImpersonation(detail, branch);
    case "text_rag_skill":
      return summarizeTextRag(branch);
    case "image_similarity_verifier":
      return summarizeImageVerifier(branch);
    case "document_review":
      return summarizeDocumentReview(branch);
    case "conflict_resolver":
      return summarizeConflict(branch);
    case "final_judge":
      return summarizeFinalJudge(result);
    default:
      return "已执行当前步骤。";
  }
}

function buildTags(action: string, detail: DetectionResultDetail | null, branch: Record<string, unknown> | null, result: DetectionResult | null) {
  const tags: string[] = [];
  const raw = isRecord(branch?.raw) ? branch.raw : null;

  switch (action) {
    case "qr_inspector": {
      const qrAnalysis = isRecord(detail?.qr_analysis) ? detail.qr_analysis : null;
      addTag(tags, "二维码");
      addTag(tags, typeof qrAnalysis?.host === "string" ? qrAnalysis.host : null);
      addTag(tags, typeof qrAnalysis?.local_risk_level === "string" ? localizeRiskLevel(qrAnalysis.local_risk_level) : null);
      addTag(tags, typeof qrAnalysis?.risk_level === "string" ? localizeRiskLevel(qrAnalysis.risk_level) : null);
      break;
    }
    case "ocr_phishing": {
      const text = typeof raw?.aggregated_text === "string" ? raw.aggregated_text.trim() : "";
      addTag(tags, "文字提取");
      addTag(tags, text ? `${Math.min(text.length, 999)} 字` : "无可用文本");
      break;
    }
    case "followup_router": {
      const agentLoop = isRecord(detail?.agent_loop) ? detail.agent_loop : null;
      const followupActions = Array.isArray(agentLoop?.followup_actions)
        ? agentLoop.followup_actions.map((item) => String(item))
        : [];
      addTag(tags, "复核");
      addTag(tags, followupActions.length ? `${followupActions.length} 个后续步骤` : "补强证据");
      break;
    }
    case "official_document_checker":
      addTag(tags, "公文");
      addTag(tags, branch?.triggered ? "疑似仿冒" : "未触发");
      break;
    case "pii_guard": {
      const hits = Array.isArray(raw?.hits) ? raw.hits.length : 0;
      addTag(tags, "隐私");
      addTag(tags, hits > 0 ? `${hits} 项命中` : "无命中");
      break;
    }
    case "impersonation_checker": {
      const matches = Array.isArray(raw?.matches) ? raw.matches.length : 0;
      const similarCount = toFiniteNumber(detail?.similar_images_count) ?? 0;
      addTag(tags, "反向搜图");
      addTag(tags, Math.max(matches, similarCount) > 0 ? `${Math.max(matches, similarCount)} 个候选` : "无候选");
      break;
    }
    case "text_rag_skill": {
      const inputMeta = isRecord(raw?.input_meta) ? raw.input_meta : null;
      const sources = Array.isArray(inputMeta?.sources) ? inputMeta.sources.map((item) => String(item)) : [];
      addTag(tags, "语义");
      if (sources.includes("submission_text")) {
        addTag(tags, "提交文本");
      }
      if (sources.includes("ocr_text")) {
        addTag(tags, "识别文字");
      }
      break;
    }
    case "image_similarity_verifier": {
      const validation = isRecord(raw?.validation) ? raw.validation : null;
      const summary = isRecord(validation?.summary) ? validation.summary : null;
      const validatedCount = toFiniteNumber(summary?.validated_match_count) ?? 0;
      addTag(tags, "本地复核");
      addTag(tags, validatedCount > 0 ? `${validatedCount} 个确认` : "未确认");
      break;
    }
    case "document_review":
      addTag(tags, "二次复核");
      addTag(tags, branch?.triggered ? "人工风格文书" : "一般文书");
      break;
    case "conflict_resolver":
      addTag(tags, "分支对齐");
      addTag(tags, branch?.triggered ? "采用保守结论" : "结果一致");
      break;
    case "final_judge":
      addTag(tags, result?.risk_level ? localizeRiskLevel(result.risk_level) : null);
      addTag(tags, result?.fraud_type ? localizeFraudType(result.fraud_type) : null);
      break;
    case "preprocess":
      addTag(tags, "任务初始化");
      break;
    case "embedding":
      addTag(tags, "特征提取");
      break;
    case "graph_reasoning":
      addTag(tags, "结果融合");
      break;
    case "finalize":
      addTag(tags, "输出整理");
      break;
    case "video_ai_detection": {
      const summary = getVideoAiSummary(detail);
      const lead = getVideoAiLead(detail);
      addTag(tags, "D3时序");
      addTag(tags, getVideoRiskTag(String(summary?.overall_risk_level ?? lead?.risk_level ?? "")));
      addTag(tags, typeof lead?.encoder === "string" ? lead.encoder : null);
      break;
    }
    case "video_physiology_judgement": {
      const summary = getVideoPhysiologySummary(detail);
      const personDetectedCount = toFiniteNumber(summary?.person_detected_count) ?? 0;
      addTag(tags, "人物状态");
      addTag(tags, personDetectedCount > 0 ? `${personDetectedCount} 个稳定人物` : "未检出稳定人脸");
      addTag(tags, getVideoRiskTag(String(summary?.overall_risk_level ?? "")));
      break;
    }
    default:
      break;
  }

  const labels = Array.isArray(branch?.labels) ? branch.labels.map((item) => String(item)) : [];
  if (!tags.length) {
    labels.slice(0, 2).forEach((item) => addTag(tags, item));
  }

  return tags.slice(0, 4);
}

function buildDetailLine(action: string, detail: DetectionResultDetail | null, branch: Record<string, unknown> | null, result: DetectionResult | null) {
  const raw = isRecord(branch?.raw) ? branch.raw : null;

  switch (action) {
    case "planner": {
      const notes = Array.isArray(detail?.planner_notes) ? detail.planner_notes.map((item) => String(item)) : [];
      return getCompactTextList(notes, 2) || null;
    }
    case "followup_router": {
      const agentLoop = isRecord(detail?.agent_loop) ? detail.agent_loop : null;
      const followupActions = Array.isArray(agentLoop?.followup_actions)
        ? agentLoop.followup_actions.map((item) => ACTION_META[String(item)]?.label ?? sanitizeDisplayText(String(item)))
        : [];
      return getCompactTextList(followupActions, 3) || null;
    }
    case "qr_inspector": {
      const qrAnalysis = isRecord(detail?.qr_analysis) ? detail.qr_analysis : null;
      const clues = Array.isArray(qrAnalysis?.clues) ? qrAnalysis.clues.map((item) => String(item)) : [];
      return getCompactTextList(
        [
          typeof qrAnalysis?.normalized_url === "string" ? qrAnalysis.normalized_url : null,
          clues.length ? `线索：${clues.slice(0, 2).map((item) => sanitizeDisplayText(item)).join("、")}` : null,
        ],
        2,
      ) || null;
    }
    case "ocr_phishing": {
      const evidenceTexts = getCompactEvidenceTexts(branch, 2);
      if (evidenceTexts.length) {
        return evidenceTexts.join(" · ");
      }
      const text = typeof raw?.aggregated_text === "string" ? raw.aggregated_text.trim() : "";
      return truncateText(text, 42) || null;
    }
    case "official_document_checker":
    case "document_review":
    case "conflict_resolver": {
      const evidenceTexts = getCompactEvidenceTexts(branch, 2);
      return evidenceTexts.join(" · ") || null;
    }
    case "pii_guard": {
      const hits = Array.isArray(raw?.hits) ? raw.hits.filter(isRecord) : [];
      return getCompactTextList(
        hits.map((item) => `${localizePiiType(String(item.type ?? ""))} ${sanitizeDisplayText(String(item.value ?? ""))}`),
        3,
      ) || null;
    }
    case "impersonation_checker": {
      const matches = Array.isArray(raw?.matches) ? raw.matches.filter(isRecord) : [];
      return getCompactTextList(
        matches.map((item) => String(item.domain ?? item.source_title ?? item.title ?? item.source_url ?? "")),
        3,
      ) || null;
    }
    case "text_rag_skill": {
      const payload = isRecord(raw?.result_payload) ? raw.result_payload : null;
      return getCompactTextList(
        [
          typeof payload?.summary === "string" ? payload.summary : null,
          typeof payload?.final_reason === "string" ? payload.final_reason : null,
        ],
        2,
      ) || null;
    }
    case "image_similarity_verifier": {
      const validation = isRecord(raw?.validation) ? raw.validation : null;
      const validatedMatches = Array.isArray(validation?.validated_matches) ? validation.validated_matches.filter(isRecord) : [];
      return getCompactTextList(
        validatedMatches.map((item) => String(item.domain ?? item.source_title ?? item.title ?? item.source_url ?? "")),
        2,
      ) || null;
    }
    case "final_judge":
      return getCompactTextList(
        [
          result?.fraud_type ? localizeFraudType(result.fraud_type) : null,
          result?.final_reason ? result.final_reason : null,
        ],
        2,
      ) || null;
    case "embedding":
      return "正在生成当前材料的检测特征。";
    case "graph_reasoning":
      return "正在汇总各模块结果并生成结论。";
    case "finalize":
      return "正在整理最终展示内容。";
    case "video_ai_detection": {
      const lead = getVideoAiLead(detail);
      if (!isRecord(lead)) {
        return null;
      }
      const fileName = sanitizeDisplayText(String(lead.file_name ?? "").trim());
      const std = toFiniteNumber(lead.second_order_std);
      return getCompactTextList(
        [
          fileName || null,
          std !== null ? `STD ${std.toFixed(3)}` : null,
        ],
        2,
      ) || null;
    }
    case "video_physiology_judgement": {
      const summary = getVideoPhysiologySummary(detail);
      const personDetectedCount = toFiniteNumber(summary?.person_detected_count);
      const skippedCount = toFiniteNumber(summary?.skipped_no_face_count);
      return getCompactTextList(
        [
          personDetectedCount !== null ? `检出人物 ${personDetectedCount}` : null,
          skippedCount !== null ? `跳过 ${skippedCount}` : null,
        ],
        2,
      ) || null;
    }
    default:
      return null;
  }
}

function buildMetrics(action: string, detail: DetectionResultDetail | null, branch: Record<string, unknown> | null, result: DetectionResult | null) {
  const metrics: Array<{ label: string; value: string | number }> = [];
  const risk = toPercent(branch?.risk_score);
  const evidenceCount = Array.isArray(branch?.evidence) ? branch.evidence.length : 0;
  const raw = isRecord(branch?.raw) ? branch.raw : null;

  if (risk !== null) {
    metrics.push({ label: "风险", value: `${risk}` });
  }
  if (evidenceCount > 0) {
    metrics.push({ label: "线索", value: evidenceCount });
  }

  if (action === "impersonation_checker") {
    const validation = isRecord(raw?.similarity_validation) ? raw.similarity_validation : null;
    const summary = isRecord(validation?.summary) ? validation.summary : null;
    const validatedCount = toFiniteNumber(summary?.validated_match_count);
    if (validatedCount !== null) {
      metrics.push({ label: "确认", value: validatedCount });
    }
  }

  if (action === "text_rag_skill") {
    const score = getResultRiskScore(result);
    if (score !== null) {
      metrics.push({ label: "风险评分", value: formatRiskScore(score) });
    }
  }

  if (action === "followup_router") {
    const agentLoop = isRecord(detail?.agent_loop) ? detail.agent_loop : null;
    const followupActions = Array.isArray(agentLoop?.followup_actions) ? agentLoop.followup_actions.length : 0;
    metrics.push({ label: "后续", value: followupActions });
  }

  if (action === "final_judge") {
    const score = getResultRiskScore(result);
    if (score !== null) {
      metrics.push({ label: "风险评分", value: formatRiskScore(score) });
    }
    if (result?.retrieved_evidence?.length) {
      metrics.push({ label: "参照", value: result.retrieved_evidence.length });
    }
  }

  if (["preprocess", "embedding", "graph_reasoning", "finalize"].includes(action)) {
    const score = getResultRiskScore(result);
    if (score !== null && action === "finalize") {
      metrics.push({ label: "风险评分", value: formatRiskScore(score) });
    }
  }

  if (action === "video_ai_detection") {
    const summary = getVideoAiSummary(detail);
    const lead = getVideoAiLead(detail);
    const analyzedCount = toFiniteNumber(summary?.analyzed_count);
    const suspiciousCount = toFiniteNumber(summary?.suspicious_count);
    const std = toFiniteNumber(lead?.second_order_std);
    if (analyzedCount !== null) {
      metrics.push({ label: "已分析", value: analyzedCount });
    }
    if (suspiciousCount !== null) {
      metrics.push({ label: "异常", value: suspiciousCount });
    }
    if (std !== null) {
      metrics.push({ label: "STD", value: std.toFixed(3) });
    }
  }

  if (action === "video_physiology_judgement") {
    const summary = getVideoPhysiologySummary(detail);
    const lead = getVideoPhysiologyLead(detail);
    const analyzedCount = toFiniteNumber(summary?.analyzed_count);
    const personDetectedCount = toFiniteNumber(summary?.person_detected_count);
    const overallScore = toFiniteNumber(lead?.overall_score);
    if (analyzedCount !== null) {
      metrics.push({ label: "已分析", value: analyzedCount });
    }
    if (personDetectedCount !== null) {
      metrics.push({ label: "人物", value: personDetectedCount });
    }
    if (overallScore !== null) {
      metrics.push({ label: "综合分", value: overallScore.toFixed(2) });
    }
  }

  return metrics.slice(0, 3);
}

function normalizeTraceItems(items: unknown): NormalizedTraceItem[] {
  if (!Array.isArray(items)) {
    return [];
  }
  return items.filter(isRecord).reduce<NormalizedTraceItem[]>((acc, item, index) => {
    const action = String(item.action ?? item.key ?? "").trim();
    if (!action) {
      return acc;
    }
    const meta = ACTION_META[action] ?? ACTION_META.final_judge;
    const label = String(item.label ?? meta.label).trim() || meta.label;
    acc.push({
      id: String(item.id ?? `${action}-${index + 1}`),
      action,
      key: String(item.key ?? action).trim() || action,
      label,
      status: String(item.status ?? "pending"),
      iteration: toFiniteNumber(item.iteration) ?? undefined,
      summary: typeof item.summary === "string" ? sanitizeDisplayText(item.summary.trim()) : undefined,
      detailLine:
        typeof item.detail_line === "string"
          ? sanitizeDisplayText(item.detail_line.trim())
          : typeof item.detailLine === "string"
            ? sanitizeDisplayText(item.detailLine.trim())
            : undefined,
      tags: normalizeTraceTags(item.tags),
      metrics: normalizeTraceMetrics(item.metrics),
    });
    return acc;
  }, []);
}

function isVideoDetectionContext(
  job?: DetectionJob | null,
  resultDetail?: DetectionResultDetail | null,
  progressDetail?: ReturnType<typeof getProgressDetail> | null,
) {
  return Boolean(
    job?.job_type === "video_ai"
    || progressDetail?.input_modality === "video"
    || Array.isArray(resultDetail?.video_ai_items)
    || Array.isArray(resultDetail?.video_deception_items),
  );
}

function mapLegacyVideoTraceToBusinessSteps(trace: NormalizedTraceItem[]): NormalizedTraceItem[] {
  const statusMap = new Map(trace.map((item) => [item.action, item.status]));
  const finalizeStatus = statusMap.get("finalize");

  let aiStatus = statusMap.get("embedding") ?? statusMap.get("preprocess") ?? "pending";
  let physiologyStatus = statusMap.get("graph_reasoning") ?? "pending";

  if (finalizeStatus === "completed") {
    aiStatus = "completed";
    physiologyStatus = "completed";
  } else if (finalizeStatus === "failed" && physiologyStatus === "pending") {
    physiologyStatus = "failed";
  }

  return [
    {
      id: "video-ai-legacy",
      action: "video_ai_detection",
      key: "video_ai_detection",
      label: ACTION_META.video_ai_detection.label,
      status: aiStatus,
      summary: aiStatus === "running" ? "正在分析视频时序连续性与异常波动。" : undefined,
    } satisfies NormalizedTraceItem,
    {
      id: "video-physiology-legacy",
      action: "video_physiology_judgement",
      key: "video_physiology_judgement",
      label: ACTION_META.video_physiology_judgement.label,
      status: physiologyStatus,
      summary: physiologyStatus === "running" ? "正在检查人脸稳定性、行为波动与非接触心率信号。" : undefined,
    } satisfies NormalizedTraceItem,
    {
      id: "video-final-legacy",
      action: "final_judge",
      key: "final_judge",
      label: ACTION_META.final_judge.label,
      status: finalizeStatus ?? "pending",
      summary:
        finalizeStatus === "completed"
          ? "已生成最终判定。"
          : finalizeStatus === "failed"
            ? "最终判定生成失败。"
            : "等待前两步完成后生成最终判定。",
    } satisfies NormalizedTraceItem,
  ];
}

function ensureVideoFinalJudge(
  trace: NormalizedTraceItem[],
  job?: DetectionJob | null,
  result?: DetectionResult | null,
): NormalizedTraceItem[] {
  if (trace.some((item) => item.action === "final_judge")) {
    return trace;
  }

  const status =
    job?.status === "failed"
      ? "failed"
      : job?.status === "completed" || Boolean(result)
        ? "completed"
        : "pending";

  return [
    ...trace,
    {
      id: "video-final-auto",
      action: "final_judge",
      key: "final_judge",
      label: ACTION_META.final_judge.label,
      status,
      summary:
        status === "completed"
          ? "已生成最终判定。"
          : status === "failed"
            ? "最终判定生成失败。"
            : "等待前两步完成后生成最终判定。",
    },
  ];
}

function getAgentExecutionItems(job?: DetectionJob | null, result?: DetectionResult | null): NormalizedTraceItem[] {
  const resultDetail = getResultDetail(result);
  const progressDetail = getProgressDetail(job);
  const trace = getPreferredTrace(job, resultDetail, progressDetail);
  const knownTrace = trace.filter((item) => item.action in ACTION_META);
  const videoContext = isVideoDetectionContext(job, resultDetail, progressDetail);

  if (videoContext) {
    const hasVideoBusinessTrace = knownTrace.some((item) =>
      ["video_ai_detection", "video_physiology_judgement"].includes(item.action),
    );
    if (hasVideoBusinessTrace) {
      return ensureVideoFinalJudge(knownTrace, job, result);
    }
    if (trace.some((item) => ["preprocess", "embedding", "graph_reasoning", "finalize"].includes(item.action))) {
      return ensureVideoFinalJudge(mapLegacyVideoTraceToBusinessSteps(trace), job, result);
    }
  }

  if (knownTrace.length) {
    return knownTrace;
  }

  const usedModules = Array.isArray(progressDetail?.used_modules)
    ? progressDetail.used_modules.map((item) => String(item))
    : [];
  if (job?.job_type === "agent_multimodal" && usedModules.includes("planner")) {
    return [
      {
        id: "planner:bootstrap",
        action: "planner",
        key: "planner",
        label: ACTION_META.planner.label,
        status: job.status === "failed" ? "failed" : job.status === "completed" ? "completed" : "running",
      } satisfies NormalizedTraceItem,
    ];
  }

  return [];
}

export function isAgentDetection(job?: DetectionJob | null, result?: DetectionResult | null) {
  const resultDetail = getResultDetail(result);
  const progressDetail = getProgressDetail(job);
  const resultUsedModules = Array.isArray(resultDetail?.used_modules) ? resultDetail.used_modules.map((item) => String(item)) : [];
  const progressUsedModules = Array.isArray(progressDetail?.used_modules) ? progressDetail.used_modules.map((item) => String(item)) : [];
  const hasAgentTrace = getPreferredTrace(job, resultDetail, progressDetail).some((item) => item.action in ACTION_META);

  return Boolean(
    result?.stage_tags?.includes("agent_orchestrated")
    || hasAgentTrace
    || Array.isArray(resultDetail?.selected_skills)
    || typeof resultDetail?.reasoning_goal === "string"
    || resultUsedModules.includes("planner")
    || progressUsedModules.includes("planner"),
  );
}

export function AgentExecutionCard({
  job,
  result,
  title = "智能体执行",
  showHeader = true,
  maxVisibleSteps,
  forceVisible = false,
}: {
  job?: DetectionJob | null;
  result?: DetectionResult | null;
  title?: string;
  showHeader?: boolean;
  maxVisibleSteps?: number;
  forceVisible?: boolean;
}) {
  const resultDetail = useMemo(() => getResultDetail(result), [result]);
  const rawItems = useMemo(() => getAgentExecutionItems(job, result), [job, result]);
  const timeline = useMemo<AgentTimelineItem[]>(() => {
    const executedCount = rawItems.filter((item) => item.status === "completed").length;
    return rawItems.map((item) => {
      const branch = getBranch(resultDetail, item.action);
      return {
        id: item.id ?? `${item.action}-${item.iteration ?? 0}`,
        action: item.action,
        label: ACTION_META[item.action]?.label ?? item.label,
        status: item.status,
        summary: item.summary || buildSummary(item.action, resultDetail, result ?? null, branch, executedCount),
        detailLine: item.detailLine ?? buildDetailLine(item.action, resultDetail, branch, result ?? null),
        tags: item.tags?.length ? item.tags : buildTags(item.action, resultDetail, branch, result ?? null),
        metrics: item.metrics?.length ? item.metrics : buildMetrics(item.action, resultDetail, branch, result ?? null),
      };
    });
  }, [rawItems, result, resultDetail]);

  const visibleTimeline = maxVisibleSteps ? timeline.slice(0, maxVisibleSteps) : timeline;
  const remainingCount = Math.max(0, timeline.length - visibleTimeline.length);
  const hasTerminalStatus = job?.status === "completed" || job?.status === "failed";
  const headerMetrics = useMemo(() => {
    const executedCount = timeline.filter((item) => item.status === "completed").length;
    const evidenceCount = Array.isArray(result?.evidence) ? result.evidence.length : 0;
    const agentLoop = isRecord(resultDetail?.agent_loop) ? resultDetail.agent_loop : null;
    const requiresFollowup = Boolean(agentLoop?.requires_followup ?? result?.need_manual_review);
    return [
      { label: "已执行", value: executedCount },
      { label: "线索", value: evidenceCount },
      { label: "状态", value: job?.status === "running" || job?.status === "pending" ? "执行中" : requiresFollowup ? "待复核" : "已收束" },
    ];
  }, [job?.status, result?.evidence, result?.need_manual_review, resultDetail?.agent_loop, timeline]);

  if (!forceVisible && !isAgentDetection(job, result)) {
    return null;
  }

  return (
    <View style={styles.card}>
      {showHeader ? (
        <View style={styles.headerRow}>
          <View style={styles.headerCopy}>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.caption}>仅展示本次实际执行的功能</Text>
          </View>
          <View style={[styles.statusPill, job?.status === "failed" ? styles.statusPillRisk : styles.statusPillSafe]}>
            <Text style={[styles.statusPillText, job?.status === "failed" ? styles.statusPillTextRisk : styles.statusPillTextSafe]}>
              {getStatusLabel(job?.status)}
            </Text>
          </View>
        </View>
      ) : null}

      <View style={styles.metricRow}>
        {headerMetrics.map((item) => (
          <View key={item.label} style={styles.metricCard}>
            <Text style={styles.metricLabel}>{item.label}</Text>
            <Text style={styles.metricValue}>{item.value}</Text>
          </View>
        ))}
      </View>

      {visibleTimeline.length ? (
        <View style={styles.timelineWrap}>
          {visibleTimeline.map((item, index) => {
            const meta = ACTION_META[item.action] ?? ACTION_META.final_judge;
            const isLast = index === visibleTimeline.length - 1;
            const isFailed = item.status === "failed";
            const isRunning = item.status === "running";
            return (
              <View key={item.id} style={styles.timelineRow}>
                <View style={styles.timelineRail}>
                  <View
                    style={[
                      styles.timelineDot,
                      {
                        backgroundColor: isFailed ? "#D96A4A" : isRunning ? palette.accentStrong : meta.tone,
                      },
                    ]}
                  />
                  {!isLast ? <View style={styles.timelineLine} /> : null}
                </View>

                <View style={styles.stepCard}>
                  <View style={styles.stepTopRow}>
                    <View style={styles.stepTitleRow}>
                      <View style={[styles.stepIconWrap, { backgroundColor: meta.soft }]}>
                        <MaterialCommunityIcons name={meta.icon} size={18} color={meta.tone} />
                      </View>
                      <View style={styles.stepTitleCopy}>
                        <Text style={styles.stepTitle}>{item.label}</Text>
                        <Text style={styles.stepSummary}>{item.summary}</Text>
                        {item.detailLine ? (
                          <Text style={styles.stepDetailLine} numberOfLines={2}>
                            {item.detailLine}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                    <View style={[styles.stepStatusPill, isFailed ? styles.stepStatusPillRisk : isRunning ? styles.stepStatusPillActive : null]}>
                      <Text style={[styles.stepStatusText, isFailed ? styles.stepStatusTextRisk : isRunning ? styles.stepStatusTextActive : null]}>
                        {getStatusLabel(item.status)}
                      </Text>
                    </View>
                  </View>

                  {item.tags.length ? (
                    <View style={styles.tagRow}>
                      {item.tags.map((tag) => (
                        <View key={`${item.id}-${tag}`} style={styles.tagChip}>
                          <Text style={styles.tagText}>{tag}</Text>
                        </View>
                      ))}
                    </View>
                  ) : null}

                  {item.metrics.length ? (
                    <View style={styles.stepMetricRow}>
                      {item.metrics.map((metric) => (
                        <View key={`${item.id}-${metric.label}`} style={styles.stepMetricChip}>
                          <Text style={styles.stepMetricLabel}>{metric.label}</Text>
                          <Text style={styles.stepMetricValue}>{metric.value}</Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>
      ) : (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>{hasTerminalStatus ? "本次结果未保留执行轨迹" : "等待执行轨迹"}</Text>
          <Text style={styles.emptyText}>
            {hasTerminalStatus ? "任务已结束，但没有可展示的执行步骤。" : "结果生成后会展示已执行的功能与对应结论。"}
          </Text>
        </View>
      )}

      {remainingCount > 0 ? <Text style={styles.moreText}>{`其余 ${remainingCount} 个步骤可在执行页查看`}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.xl,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 14,
    ...panelShadow,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  headerCopy: {
    flex: 1,
    gap: 4,
  },
  title: {
    color: palette.ink,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  caption: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 17,
    fontFamily: fontFamily.body,
  },
  statusPill: {
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  statusPillSafe: {
    backgroundColor: "#E9FAF4",
  },
  statusPillRisk: {
    backgroundColor: "#FFE7E7",
  },
  statusPillText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  statusPillTextSafe: {
    color: "#2E9D7F",
  },
  statusPillTextRisk: {
    color: "#C62828",
  },
  metricRow: {
    flexDirection: "row",
    gap: 10,
  },
  metricCard: {
    flex: 1,
    borderRadius: radius.md,
    backgroundColor: palette.surfaceSoft,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 4,
  },
  metricLabel: {
    color: palette.inkSoft,
    fontSize: 11,
    lineHeight: 14,
    fontFamily: fontFamily.body,
  },
  metricValue: {
    color: palette.ink,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  timelineWrap: {
    gap: 12,
  },
  timelineRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 10,
  },
  timelineRail: {
    width: 18,
    alignItems: "center",
  },
  timelineDot: {
    width: 12,
    height: 12,
    borderRadius: 999,
    marginTop: 14,
  },
  timelineLine: {
    flex: 1,
    width: 2,
    marginTop: 8,
    marginBottom: -2,
    backgroundColor: "#D6E4FA",
    borderRadius: 999,
  },
  stepCard: {
    flex: 1,
    borderRadius: radius.lg,
    backgroundColor: palette.surfaceSoft,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 10,
  },
  stepTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
  },
  stepTitleRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  stepIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  stepTitleCopy: {
    flex: 1,
    gap: 4,
  },
  stepTitle: {
    color: palette.ink,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  stepSummary: {
    color: palette.ink,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  stepDetailLine: {
    color: palette.inkSoft,
    fontSize: 11,
    lineHeight: 16,
    fontFamily: fontFamily.body,
  },
  stepStatusPill: {
    borderRadius: radius.pill,
    backgroundColor: palette.surface,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  stepStatusPillActive: {
    backgroundColor: "#EAF2FF",
  },
  stepStatusPillRisk: {
    backgroundColor: "#FFE7E7",
  },
  stepStatusText: {
    color: palette.inkSoft,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  stepStatusTextActive: {
    color: palette.accentStrong,
  },
  stepStatusTextRisk: {
    color: "#C62828",
  },
  tagRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  tagChip: {
    borderRadius: radius.pill,
    backgroundColor: palette.surface,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  tagText: {
    color: palette.accentStrong,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  stepMetricRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  stepMetricChip: {
    borderRadius: radius.pill,
    backgroundColor: "rgba(255,255,255,0.75)",
    paddingHorizontal: 10,
    paddingVertical: 7,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  stepMetricLabel: {
    color: palette.inkSoft,
    fontSize: 11,
    lineHeight: 14,
    fontFamily: fontFamily.body,
  },
  stepMetricValue: {
    color: palette.ink,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  emptyWrap: {
    borderRadius: radius.lg,
    backgroundColor: palette.surfaceSoft,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 14,
    paddingVertical: 16,
    gap: 6,
  },
  emptyTitle: {
    color: palette.ink,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  emptyText: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  moreText: {
    color: palette.inkSoft,
    fontSize: 11,
    lineHeight: 16,
    fontFamily: fontFamily.body,
  },
});
