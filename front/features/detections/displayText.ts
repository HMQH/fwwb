import type { DetectionResult } from "./types";

const FRAUD_TYPE_LABEL_MAP: Record<string, string> = {
  sensitive_information_exposure: "敏感信息泄露",
  impersonation_or_stolen_image: "盗图冒充",
  suspicious_qr: "可疑二维码",
  forged_official_document: "仿冒公文",
  phishing_image: "钓鱼图片",
  phishing_site: "钓鱼网站",
  voice_scam_call: "语音诈骗来电",
  unknown: "未知类型",
};

const RISK_LEVEL_LABEL_MAP: Record<string, string> = {
  high: "高风险",
  medium: "中风险",
  low: "低风险",
  suspicious: "可疑",
  safe: "安全",
  benign: "较安全",
  malicious: "高风险",
  info: "提示",
  pending: "待处理",
  running: "进行中",
  completed: "已完成",
  failed: "失败",
};

const PII_TYPE_LABEL_MAP: Record<string, string> = {
  phone: "手机号",
  id_card: "身份证号",
  bank_card: "银行卡号",
  verification_code: "验证码",
  email: "邮箱",
  address: "住址",
  name: "姓名",
  account: "账号",
};

const ENGLISH_TEXT_MAP: Record<string, string> = {
  "no obvious sensitive information was detected.": "未发现明显敏感信息。",
  "sensitive personal or financial information appears in the available text.": "可用文字中出现了敏感个人或金融信息。",
  "mask personal identifiers before sharing screenshots or documents.": "分享截图或证件前，先遮挡个人敏感信息。",
  "do not send verification codes, id numbers, or bank card numbers to strangers.": "不要把验证码、身份证号或银行卡号发送给陌生人。",
  "no obvious phishing copy was found in the available text.": "未发现明显诱导或钓鱼话术。",
  "no extractable text is available yet; ocr is still running in stub mode.": "当前还没有可提取文字，文字识别结果暂不完整。",
  "the extracted text includes persuasion or phishing-style phrases.": "提取文字中存在诱导或钓鱼式话术。",
  "only stub ocr hints are available, so phishing copy analysis is limited.": "当前仅有基础文字识别提示，诱导识别能力有限。",
  "cross-check the notice with an official channel before taking action.": "操作前先通过官方渠道核验通知真伪。",
  "treat authority claims as unverified until the institution confirms them.": "涉及官方、银行、客服等权威说法前，先核实再处理。",
  "official-style document cues": "公文样式线索",
  "suspicious action inside official-looking notice": "公文内出现高风险动作",
  "private contact info found": "发现私人联系方式",
  "pressure language detected": "命中施压催促语",
  "missing formal document number": "缺少正式文号",
  "llm review point": "模型复核线索",
  "no obvious suspicious formal-document cues were found.": "未发现明显公文仿冒线索。",
  "the image appears to imitate an official document and includes suspicious cues consistent with forged notice scams.": "图片疑似仿冒公文，并包含常见伪造通知线索。",
  "the image resembles an official notice, but only limited suspicious cues were found from the current ocr text.": "图片看起来像正式通知，但当前识别文字中的可疑线索有限。",
  "the image filename suggests it may be an official notice, but ocr text is insufficient for deeper verification.": "图片文件名提示它可能是正式通知，但当前文字不足以深入核验。",
  "no ocr text or filename hints are available for official-document analysis.": "当前没有可用文字或文件名线索，暂无法完成公文核验。",
};

const LABEL_MAP: Record<string, string> = {
  copy_urgency: "紧迫催促",
  copy_authority: "冒充权威",
  copy_reward: "利益诱导",
  copy_fear: "威胁恐吓",
  official_doc_candidate: "公文样式线索",
  official_doc_authority_style: "权威公文样式",
  official_doc_suspicious_action: "高风险动作",
  official_doc_private_contact: "私人联系方式",
  official_doc_pressure_language: "施压催促语",
  official_doc_missing_case_number: "缺少正式文号",
  official_doc_missing_date: "缺少日期",
  forged_official_document_suspected: "疑似仿冒公文",
  qr_code_detected: "检测到二维码",
  qr_contains_link: "二维码含链接",
  qr_link_normalized: "已规范化链接",
  qr_points_to_ip_host: "指向 IP 地址",
  qr_link_has_sensitive_action: "链接含敏感动作",
  qr_payment_scheme: "支付二维码",
  qr_local_url_high: "本地模型判定高风险",
  qr_local_url_medium: "本地模型判定中风险",
  qr_local_url_suspicious: "本地模型判定可疑",
  qr_local_url_safe: "本地模型判定安全",
  pii_phone: "手机号",
  pii_id_card: "身份证号",
  pii_bank_card: "银行卡号",
  pii_verification_code: "验证码",
  branch_conflict_detected: "分支结论冲突",
  branch_conflict_not_found: "分支结论一致",
  document_review_candidate: "进入文书复核",
  document_review_forgery_suspected: "疑似文书伪造",
  document_review_authenticity_gap: "存在真实性缺口",
  document_review_actionable: "建议人工处理",
  image_similarity_hash_near_duplicate: "近同图命中",
  image_similarity_clip_high: "高相似命中",
  image_similarity_clip_medium: "中等相似",
  image_similarity_cross_site_reuse: "跨站复用",
  image_similarity_partial_match: "部分匹配",
  image_similarity_unconfirmed: "候选未确认",
  impersonation_multi_site_match: "多站点命中",
  impersonation_public_match: "公开来源命中",
  impersonation_social_media_source: "社交平台来源",
  impersonation_public_content_site: "公共内容站点",
  impersonation_hash_near_duplicate: "近同图",
  impersonation_clip_high_similarity: "高相似",
  impersonation_clip_medium_similarity: "中等相似",
  impersonation_cross_site_confirmed: "跨站确认",
  impersonation_unverified_reverse_match: "候选待确认",
  text_rag_high: "文本高风险",
  text_rag_medium: "文本中风险",
  text_rag_low: "文本低风险",
  text_rag_info: "文本提示",
};

function normalizeCode(value?: string | null) {
  return String(value ?? "").trim().toLowerCase();
}

function localizeCategory(value?: string | null) {
  const normalized = normalizeCode(value);
  if (normalized === "urgency") {
    return "紧迫催促";
  }
  if (normalized === "authority") {
    return "冒充权威";
  }
  if (normalized === "reward") {
    return "利益诱导";
  }
  if (normalized === "fear") {
    return "威胁恐吓";
  }
  return String(value ?? "").trim();
}

function replaceEnglishPatterns(value: string) {
  let next = value;
  next = next.replace(/^Detected\s+(.+)$/i, (_match, type) => `命中${localizePiiType(type)}`);
  next = next.replace(/^Matched value:\s*/i, "命中内容：");
  next = next.replace(/^Matched\s+(.+?)\s+phrase$/i, (_match, category) => `命中${localizeCategory(category)}词`);
  next = next.replace(/^Detected phrase:\s*/i, "命中短语：");
  next = next.replace(/^Detected title \/ issuer cues:\s*/i, "抬头/落款线索：");
  next = next.replace(/^Detected action phrases:\s*/i, "命中动作：");
  next = next.replace(/^Detected personal contact \/ link cues:\s*/i, "命中联系方式/链接：");
  next = next.replace(/^Detected urgency phrases:\s*/i, "命中催促语：");
  next = next.replace(/^risk\s+([a-z_]+)$/i, (_match, level) => localizeRiskLevel(level));
  return next;
}

export function localizeFraudType(value?: string | null) {
  const text = String(value ?? "").trim();
  if (!text) {
    return "";
  }
  const mapped = FRAUD_TYPE_LABEL_MAP[normalizeCode(text)];
  return mapped ?? text;
}

export function localizeRiskLevel(value?: string | null) {
  const text = String(value ?? "").trim();
  if (!text) {
    return "";
  }
  const mapped = RISK_LEVEL_LABEL_MAP[normalizeCode(text)];
  return mapped ?? text;
}

export function localizePiiType(value?: string | null) {
  const text = String(value ?? "").trim();
  if (!text) {
    return "";
  }
  return PII_TYPE_LABEL_MAP[normalizeCode(text)] ?? text;
}

export function sanitizeDisplayText(value?: string | null) {
  const text = String(value ?? "").trim();
  if (!text) {
    return "";
  }

  const exactText = ENGLISH_TEXT_MAP[normalizeCode(text)];
  if (exactText) {
    return exactText;
  }

  const exactLabel = LABEL_MAP[normalizeCode(text)];
  if (exactLabel) {
    return exactLabel;
  }

  const fraudType = FRAUD_TYPE_LABEL_MAP[normalizeCode(text)];
  if (fraudType) {
    return fraudType;
  }

  const riskLevel = RISK_LEVEL_LABEL_MAP[normalizeCode(text)];
  if (riskLevel) {
    return riskLevel;
  }

  const piiType = PII_TYPE_LABEL_MAP[normalizeCode(text)];
  if (piiType) {
    return piiType;
  }

  let next = replaceEnglishPatterns(text);
  Object.entries(FRAUD_TYPE_LABEL_MAP).forEach(([key, label]) => {
    next = next.replace(new RegExp(`\\b${key}\\b`, "gi"), label);
  });
  Object.entries(RISK_LEVEL_LABEL_MAP).forEach(([key, label]) => {
    next = next.replace(new RegExp(`\\b${key}\\b`, "gi"), label);
  });
  Object.entries(PII_TYPE_LABEL_MAP).forEach(([key, label]) => {
    next = next.replace(new RegExp(`\\b${key}\\b`, "gi"), label);
  });
  Object.entries(LABEL_MAP).forEach(([key, label]) => {
    next = next.replace(new RegExp(`\\b${key}\\b`, "gi"), label);
  });

  return next;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toScoreNumber(value: unknown) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }
  const normalized = value >= 0 && value <= 1 ? value * 100 : value;
  return Math.max(0, Math.min(100, Math.round(normalized)));
}

export function getResultRiskScore(
  result?: Pick<DetectionResult, "confidence" | "risk_score" | "result_detail"> | null,
) {
  if (!result) {
    return null;
  }

  const direct = toScoreNumber(result.risk_score);
  if (direct !== null) {
    return direct;
  }

  const detail = isRecord(result.result_detail) ? result.result_detail : null;
  const detailScore = toScoreNumber(detail?.final_score);
  if (detailScore !== null) {
    return detailScore;
  }

  const reasoningGraph = isRecord(detail?.reasoning_graph) ? detail.reasoning_graph : null;
  const summaryMetrics = isRecord(reasoningGraph?.summary_metrics) ? reasoningGraph.summary_metrics : null;
  const graphScore = toScoreNumber(summaryMetrics?.final_score);
  if (graphScore !== null) {
    return graphScore;
  }

  return toScoreNumber(result.confidence);
}

export function formatRiskScore(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "--";
  }
  return `${Math.round(Math.max(0, Math.min(100, value)))}`;
}
