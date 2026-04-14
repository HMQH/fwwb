import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";

import type { DetectionJob, DetectionResult } from "../types";

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
    label: "暂低风险",
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
    const pending = job?.status === "pending" || job?.status === "running";
    const failed = job?.status === "failed";
    return (
      <View style={[styles.card, compact && styles.cardCompact, failed && styles.cardFailed]}>
        <View style={styles.headerRow}>
          <View style={[styles.heroIcon, { backgroundColor: failed ? "#FFF0EA" : palette.accentSoft }]}>
            <MaterialCommunityIcons
              name={failed ? "alert-circle-outline" : "progress-clock"}
              size={compact ? 18 : 22}
              color={failed ? "#D96A4A" : palette.accentStrong}
            />
          </View>
          <View style={styles.headerCopy}>
            <Text style={[styles.title, compact && styles.titleCompact]}>
              {failed ? "检测失败" : pending ? "正在分析文本" : "等待分析结果"}
            </Text>
            <Text style={styles.subtitle}>
              {failed
                ? job?.error_message ?? "本次任务未完成，可稍后重试。"
                : "规则引擎、黑白样本检索和模型判定正在协同处理。"}
            </Text>
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
            <View style={[styles.riskPill, { backgroundColor: meta.soft }]}>
              <Text style={[styles.riskPillText, { color: meta.tone }]}>{result.fraud_type ?? "未分类"}</Text>
            </View>
          </View>
          <Text style={styles.subtitle}>{result.summary ?? "暂无总结"}</Text>
        </View>
      </View>

      <View style={styles.metricsRow}>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>可信度</Text>
          <Text style={styles.metricValue}>{formatConfidence(result.confidence)}</Text>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>黑样本证据</Text>
          <Text style={styles.metricValue}>{evidenceCount}</Text>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>白样本对照</Text>
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

      <Text style={styles.reasonText}>{result.final_reason ?? ""}</Text>

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
  subtitle: {
    color: palette.inkSoft,
    fontSize: 13,
    lineHeight: 19,
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
