import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";

import type { DetectionJob, DetectionResult } from "../types";
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
  return isKnownFraudType(result.fraud_type) ? String(result.fraud_type).trim() : null;
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
  return summary.split(/[。！!？?\n]/)[0]?.trim() || summary;
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
          <Text style={styles.summaryText}>{result.summary ?? "--"}</Text>
        </View>
      </View>

      <View style={styles.metricsRow}>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>可信度</Text>
          <Text style={styles.metricValue}>{formatConfidence(result.confidence)}</Text>
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
              <Text style={styles.ruleChipText}>{item}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {result.final_reason ? <Text style={styles.reasonText}>{result.final_reason}</Text> : null}

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
