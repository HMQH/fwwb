import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";

import type { DetectionJob, DetectionResult, DetectionResultDetail } from "../types";
import { getProgressDetail, getResultDetail } from "../visualization";

type AgentTimelineItem = {
  id: string;
  action: string;
  label: string;
  status: string;
  summary: string;
  tags: string[];
  metrics: Array<{ label: string; value: string | number }>;
};

type NormalizedTraceItem = {
  id: string;
  action: string;
  key: string;
  label: string;
  status: string;
  iteration?: number;
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
  qr_inspector: {
    label: "二维码检查",
    icon: "qrcode-scan",
    soft: "#FFF2EA",
    tone: "#D96A4A",
  },
  ocr_phishing: {
    label: "图文 OCR",
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
  if (status === "failed") {
    return "失败";
  }
  if (status === "running") {
    return "进行中";
  }
  return "待执行";
}

function addTag(target: string[], value?: string | null) {
  const text = String(value ?? "").trim();
  if (!text || target.includes(text)) {
    return;
  }
  target.push(text);
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
    return result.summary.trim();
  }
  return "已汇总各步骤输出并生成最终结论。";
}

function buildSummary(action: string, detail: DetectionResultDetail | null, result: DetectionResult | null, branch: Record<string, unknown> | null, executedCount: number) {
  switch (action) {
    case "planner":
      return summarizePlanner(detail, executedCount);
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
      addTag(tags, typeof qrAnalysis?.risk_level === "string" ? `风险 ${qrAnalysis.risk_level}` : null);
      break;
    }
    case "ocr_phishing": {
      const text = typeof raw?.aggregated_text === "string" ? raw.aggregated_text.trim() : "";
      addTag(tags, "OCR");
      addTag(tags, text ? `${Math.min(text.length, 999)} 字` : "无可用文本");
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
        addTag(tags, "OCR 文本");
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
      addTag(tags, result?.risk_level ? `风险 ${result.risk_level}` : null);
      addTag(tags, result?.fraud_type);
      break;
    default:
      break;
  }

  const labels = Array.isArray(branch?.labels) ? branch.labels.map((item) => String(item)) : [];
  if (!tags.length) {
    labels.slice(0, 2).forEach((item) => addTag(tags, item.replaceAll("_", " ")));
  }

  return tags.slice(0, 4);
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
    const payload = isRecord(raw?.result_payload) ? raw.result_payload : null;
    const confidence = toPercent(payload?.confidence ?? result?.confidence);
    if (confidence !== null) {
      metrics.push({ label: "可信度", value: `${confidence}` });
    }
  }

  if (action === "final_judge") {
    const finalScore = toPercent(detail?.final_score ?? result?.confidence);
    if (finalScore !== null && !metrics.some((item) => item.label === "风险")) {
      metrics.push({ label: "评分", value: `${finalScore}` });
    }
    if (result?.retrieved_evidence?.length) {
      metrics.push({ label: "参照", value: result.retrieved_evidence.length });
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
    });
    return acc;
  }, []);
}

function getAgentExecutionItems(job?: DetectionJob | null, result?: DetectionResult | null) {
  const resultDetail = getResultDetail(result);
  const progressDetail = getProgressDetail(job);
  const rawTrace =
    resultDetail?.module_trace
    ?? resultDetail?.execution_trace
    ?? progressDetail?.module_trace
    ?? progressDetail?.execution_trace;
  const trace = normalizeTraceItems(rawTrace);
  const agentTrace = trace.filter((item) => item.action in ACTION_META);

  if (agentTrace.length) {
    return agentTrace;
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
        status: job.status === "failed" ? "failed" : "completed",
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
  const hasAgentTrace = normalizeTraceItems(
    resultDetail?.execution_trace
    ?? resultDetail?.module_trace
    ?? progressDetail?.execution_trace
    ?? progressDetail?.module_trace,
  ).some((item) => item.action in ACTION_META);

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
  title = "Agent 执行",
  showHeader = true,
  maxVisibleSteps,
}: {
  job?: DetectionJob | null;
  result?: DetectionResult | null;
  title?: string;
  showHeader?: boolean;
  maxVisibleSteps?: number;
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
        summary: buildSummary(item.action, resultDetail, result ?? null, branch, executedCount),
        tags: buildTags(item.action, resultDetail, branch, result ?? null),
        metrics: buildMetrics(item.action, resultDetail, branch, result ?? null),
      };
    });
  }, [rawItems, result, resultDetail]);

  const visibleTimeline = maxVisibleSteps ? timeline.slice(0, maxVisibleSteps) : timeline;
  const remainingCount = Math.max(0, timeline.length - visibleTimeline.length);
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

  if (!isAgentDetection(job, result)) {
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
          <Text style={styles.emptyTitle}>等待执行轨迹</Text>
          <Text style={styles.emptyText}>结果生成后会展示已执行的功能与对应结论。</Text>
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
