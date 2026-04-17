import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";

import {
  formatRiskScore,
  getResultRiskScore,
  localizeFraudType,
  localizeRiskLevel,
  sanitizeDisplayText,
} from "../displayText";
import type { DetectionJob, DetectionQrAnalysis, DetectionResult } from "../types";
import { normalizeDetectionStep, pipelineStepMeta } from "../visualization";

const riskMeta = {
  high: {
    label: "高风险",
    icon: "shield-alert-outline",
    tone: "#D96A4A",
    soft: "#FFF0EA",
  },
  medium: {
    label: "需核验",
    icon: "shield-half-full",
    tone: "#C48A29",
    soft: "#FFF7E8",
  },
  low: {
    label: "低风险",
    icon: "shield-check-outline",
    tone: "#2F70E6",
    soft: "#EAF2FF",
  },
} as const;

type RiskLevelKey = keyof typeof riskMeta;

export function getRiskMeta(level?: string | null) {
  const key = (level ?? "low") as RiskLevelKey;
  return riskMeta[key] ?? riskMeta.low;
}

export function formatConfidence(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "--";
  }
  return `${Math.round(value * 100)}%`;
}

function isKnownFraudType(value?: string | null) {
  const normalized = String(value ?? "").trim();
  return Boolean(normalized && !["未知", "未分类", "待定", "不确定"].includes(normalized));
}

export function getVisibleFraudType(result?: Pick<DetectionResult, "risk_level" | "fraud_type"> | null) {
  if (!result || result.risk_level === "low") {
    return null;
  }
  return isKnownFraudType(result.fraud_type) ? localizeFraudType(String(result.fraud_type).trim()) : null;
}

export function getResultHeadline(
  result?: Pick<DetectionResult, "risk_level" | "fraud_type" | "summary"> | null,
) {
  const visibleFraudType = getVisibleFraudType(result ? { risk_level: result.risk_level, fraud_type: result.fraud_type } : null);
  if (visibleFraudType) {
    return visibleFraudType;
  }
  const summary = String(result?.summary ?? "").trim();
  if (!summary) {
    return result?.risk_level === "low" ? "低风险结果" : "待分析文本";
  }
  return sanitizeDisplayText(summary.split(/[。！!？?\n]/)[0]?.trim() || summary);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getQrAnalysis(result?: DetectionResult | null): DetectionQrAnalysis | null {
  const detail = result?.result_detail;
  if (!isRecord(detail)) {
    return null;
  }
  if (isRecord(detail.qr_analysis)) {
    return detail.qr_analysis as DetectionQrAnalysis;
  }
  const branches = isRecord(detail.branches) ? detail.branches : null;
  const qrResult = branches && isRecord(branches.qr_result) ? branches.qr_result : null;
  if (!qrResult) {
    return null;
  }
  const evidenceItems = Array.isArray(qrResult.evidence) ? qrResult.evidence : [];
  const firstEvidence = evidenceItems.find(isRecord);
  const extra = firstEvidence && isRecord(firstEvidence.extra) ? firstEvidence.extra : null;
  const raw = isRecord(qrResult.raw) ? qrResult.raw : null;
  const urlPredictionItems =
    raw && Array.isArray(raw.url_predictions)
      ? raw.url_predictions
      : raw && Array.isArray(raw.local_url_predictions)
        ? raw.local_url_predictions
        : [];
  const firstPrediction = urlPredictionItems.find(isRecord);
  if (!extra && !firstPrediction && !qrResult.summary) {
    return null;
  }
  return {
    payload: String(extra?.payload ?? ""),
    normalized_url: String(extra?.normalized_url ?? firstPrediction?.url ?? ""),
    host: String(extra?.host ?? ""),
    destination_label: String(extra?.destination_label ?? ""),
    destination_kind: String(extra?.destination_kind ?? ""),
    risk_score: typeof qrResult.risk_score === "number" ? qrResult.risk_score : null,
    risk_level: typeof result?.risk_level === "string" ? result.risk_level : null,
    summary: typeof qrResult.summary === "string" ? qrResult.summary : null,
    final_reason: typeof firstEvidence?.detail === "string" ? firstEvidence.detail : null,
    local_risk_level: String(firstPrediction?.risk_level ?? ""),
    local_model_name: String(firstPrediction?.model_name ?? ""),
    phish_prob: typeof firstPrediction?.phish_prob === "number" ? firstPrediction.phish_prob : null,
    clues: Array.isArray(firstPrediction?.clues)
      ? firstPrediction.clues.map((item) => sanitizeDisplayText(String(item))).filter(Boolean)
      : [],
  };
}

function getQrRiskCopy(qr?: DetectionQrAnalysis | null) {
  const verdict = String(qr?.local_risk_level ?? qr?.risk_level ?? "").toLowerCase();
  if (verdict === "high" || verdict === "malicious") {
    return { label: "高风险", tone: "#D96A4A", soft: "#FFF0EA" };
  }
  if (verdict === "medium" || verdict === "suspicious") {
    return { label: "需核验", tone: "#C48A29", soft: "#FFF7E8" };
  }
  if (verdict === "safe" || verdict === "benign" || verdict === "low") {
    return { label: "较安全", tone: "#2E9D7F", soft: "#E9FAF4" };
  }
  const score = typeof qr?.risk_score === "number" ? qr.risk_score : 0;
  if (score >= 0.5) {
    return { label: "高风险", tone: "#D96A4A", soft: "#FFF0EA" };
  }
  if (score >= 0.3) {
    return { label: "需核验", tone: "#C48A29", soft: "#FFF7E8" };
  }
  return { label: "低风险", tone: "#2F70E6", soft: "#EAF2FF" };
}

function compactQrPayload(value?: string | null) {
  const text = String(value ?? "").trim();
  if (!text) {
    return "--";
  }
  return text.length > 72 ? `${text.slice(0, 72)}…` : text;
}

function getQrDestinationText(qr?: DetectionQrAnalysis | null) {
  const label = String(qr?.destination_label ?? "").trim();
  const host = String(qr?.host ?? "").trim();
  const url = String(qr?.normalized_url ?? "").trim();
  if (label && host) {
    return `${label} ${host}`;
  }
  if (label) {
    return label;
  }
  if (host) {
    return host;
  }
  if (url) {
    return compactQrPayload(url);
  }
  return "未识别去向";
}

export function DetectionResultCard({
  result,
  job,
  compact = false,
  onOpenDetail,
  onRerun,
}: {
  result?: DetectionResult | null;
  job?: DetectionJob | null;
  compact?: boolean;
  onOpenDetail?: () => void;
  onRerun?: () => void;
}) {
  if (!result) {
    const failed = job?.status === "failed";
    const running = job?.status === "pending" || job?.status === "running";
    const step = normalizeDetectionStep(job?.current_step ?? undefined, job?.status ?? undefined);
    const meta = pipelineStepMeta[step];
    return (
      <View style={[styles.card, compact && styles.cardCompact, failed && styles.cardFailed]}>
        <View style={styles.headerRow}>
          <View style={[styles.heroIcon, { backgroundColor: failed ? "#FFF0EA" : meta.soft }]}>
            <MaterialCommunityIcons
              name={failed ? "alert-circle-outline" : (meta.icon as never)}
              size={compact ? 18 : 22}
              color={failed ? "#D96A4A" : meta.accent}
            />
          </View>
          <View style={styles.headerCopy}>
            <Text style={[styles.title, compact && styles.titleCompact]}>
              {failed ? "检测失败" : running ? meta.label : "等待结果"}
            </Text>
            <View style={styles.inlineMetaRow}>
              {typeof job?.progress_percent === "number" ? (
                <View style={[styles.inlinePill, { backgroundColor: meta.soft }]}>
                  <Text style={[styles.inlinePillText, { color: meta.accent }]}>
                    {Math.round(job.progress_percent)}%
                  </Text>
                </View>
              ) : null}
              {job?.error_message ? <Text style={styles.pendingText}>{job.error_message}</Text> : null}
            </View>
          </View>
        </View>

        {failed && onRerun ? (
          <Pressable style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]} onPress={onRerun}>
            <MaterialCommunityIcons name="reload" size={16} color={palette.accentStrong} />
            <Text style={styles.secondaryButtonText}>重新运行</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  const meta = getRiskMeta(result.risk_level);
  const visibleFraudType = getVisibleFraudType(result);
  const evidenceCount = result.retrieved_evidence.length;
  const counterCount = result.counter_evidence.length;
  const qrAnalysis = getQrAnalysis(result);
  const qrRiskCopy = getQrRiskCopy(qrAnalysis);

  return (
    <View style={[styles.card, compact && styles.cardCompact]}>
      <View style={styles.headerRow}>
        <View style={[styles.heroIcon, { backgroundColor: meta.soft }]}>
          <MaterialCommunityIcons name={meta.icon} size={compact ? 18 : 22} color={meta.tone} />
        </View>
        <View style={styles.headerCopy}>
          <View style={styles.titleRow}>
            <Text style={[styles.title, compact && styles.titleCompact]}>{meta.label}</Text>
            {visibleFraudType ? (
              <View style={[styles.riskPill, { backgroundColor: meta.soft }]}>
                <Text style={[styles.riskPillText, { color: meta.tone }]}>
                  {visibleFraudType}
                </Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.summaryText}>{sanitizeDisplayText(result.summary ?? "--")}</Text>
        </View>
      </View>

      <View style={styles.metricsRow}>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>风险评分</Text>
          <Text style={styles.metricValue}>{formatRiskScore(getResultRiskScore(result))}</Text>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>风险参照</Text>
          <Text style={styles.metricValue}>{evidenceCount}</Text>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>安全参照</Text>
          <Text style={styles.metricValue}>{counterCount}</Text>
        </View>
      </View>

      {result.hit_rules.length ? (
        <View style={styles.chipWrap}>
          {result.hit_rules.slice(0, compact ? 3 : 6).map((item) => (
            <View key={item} style={styles.ruleChip}>
              <Text style={styles.ruleChipText}>{sanitizeDisplayText(item)}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {result.final_reason ? <Text style={styles.reasonText}>{sanitizeDisplayText(result.final_reason)}</Text> : null}

      {qrAnalysis ? (
        <View style={styles.qrBlock}>
          <View style={styles.qrHeaderRow}>
            <Text style={styles.qrTitle}>二维码识别</Text>
            <View style={[styles.qrPill, { backgroundColor: qrRiskCopy.soft }]}>
              <Text style={[styles.qrPillText, { color: qrRiskCopy.tone }]}>{qrRiskCopy.label}</Text>
            </View>
          </View>

          <View style={styles.qrInfoGrid}>
            <View style={styles.qrInfoCard}>
              <Text style={styles.qrInfoLabel}>二维码内容</Text>
              <Text style={styles.qrInfoValue}>{compactQrPayload(qrAnalysis.payload)}</Text>
            </View>
            <View style={styles.qrInfoCard}>
              <Text style={styles.qrInfoLabel}>识别去向</Text>
              <Text style={styles.qrInfoValue}>{getQrDestinationText(qrAnalysis)}</Text>
            </View>
          </View>

          {qrAnalysis.local_risk_level ? (
            <View style={styles.inlineMetaRow}>
              <View style={[styles.inlinePill, { backgroundColor: qrRiskCopy.soft }]}>
                <Text style={[styles.inlinePillText, { color: qrRiskCopy.tone }]}>
                  {localizeRiskLevel(qrAnalysis.local_risk_level)}
                </Text>
              </View>
              {qrAnalysis.local_model_name ? (
                <View style={styles.inlinePill}>
                  <Text style={styles.inlinePillText}>本地模型</Text>
                </View>
              ) : null}
            </View>
          ) : null}

          <Text style={styles.qrSummaryText}>
            {sanitizeDisplayText(
              String(qrAnalysis.summary ?? "").trim()
                || String(qrAnalysis.final_reason ?? "").trim()
                || "已识别二维码内容，请结合去向与业务场景核验。",
            )}
          </Text>
        </View>
      ) : null}

      {(onOpenDetail || onRerun) && !compact ? (
        <View style={styles.actionRow}>
          {onOpenDetail ? (
            <Pressable style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed]} onPress={onOpenDetail}>
              <Text style={styles.primaryButtonText}>查看详情</Text>
              <MaterialCommunityIcons name="arrow-right" size={16} color={palette.inkInverse} />
            </Pressable>
          ) : null}
          {onRerun ? (
            <Pressable style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]} onPress={onRerun}>
              <MaterialCommunityIcons name="reload" size={16} color={palette.accentStrong} />
              <Text style={styles.secondaryButtonText}>重新检测</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 14,
    ...panelShadow,
  },
  cardCompact: {
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  cardFailed: {
    borderColor: "#F0C9BE",
  },
  headerRow: {
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-start",
  },
  heroIcon: {
    width: 44,
    height: 44,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  headerCopy: {
    flex: 1,
    gap: 6,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  title: {
    color: palette.ink,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  titleCompact: {
    fontSize: 16,
    lineHeight: 22,
  },
  inlineMetaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    alignItems: "center",
  },
  inlinePill: {
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  inlinePillText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  pendingText: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  summaryText: {
    color: palette.ink,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: fontFamily.body,
  },
  riskPill: {
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  riskPillText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  metricsRow: {
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
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  chipWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  ruleChip: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: palette.backgroundDeep,
  },
  ruleChipText: {
    color: palette.accentStrong,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  reasonText: {
    color: palette.ink,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: fontFamily.body,
  },
  qrBlock: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.surfaceSoft,
    padding: 14,
    gap: 12,
  },
  qrHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  qrTitle: {
    color: palette.ink,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  qrPill: {
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  qrPillText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  qrInfoGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  qrInfoCard: {
    flex: 1,
    minWidth: 140,
    borderRadius: radius.md,
    backgroundColor: palette.surface,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 6,
  },
  qrInfoLabel: {
    color: palette.inkSoft,
    fontSize: 11,
    lineHeight: 14,
    fontFamily: fontFamily.body,
  },
  qrInfoValue: {
    color: palette.ink,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  qrSummaryText: {
    color: palette.ink,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: fontFamily.body,
  },
  actionRow: {
    flexDirection: "row",
    gap: 10,
    flexWrap: "wrap",
  },
  primaryButton: {
    minHeight: 42,
    borderRadius: radius.pill,
    backgroundColor: palette.accentStrong,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  primaryButtonText: {
    color: palette.inkInverse,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  secondaryButton: {
    minHeight: 42,
    borderRadius: radius.pill,
    backgroundColor: palette.accentSoft,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "flex-start",
  },
  secondaryButtonText: {
    color: palette.accentStrong,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  buttonPressed: {
    transform: [{ scale: 0.98 }],
  },
});
