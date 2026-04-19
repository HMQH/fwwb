import { MaterialCommunityIcons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";

import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";

import type { ScamDecision, ScamDynamics } from "../types";

const riskMeta = {
  critical: {
    label: "极高风险",
    icon: "alert-octagon" as const,
    tone: "#FF9E86",
    soft: "rgba(255, 158, 134, 0.16)",
  },
  high: {
    label: "高风险",
    icon: "alert-circle-outline" as const,
    tone: "#FFB08D",
    soft: "rgba(255, 176, 141, 0.16)",
  },
  medium: {
    label: "中风险",
    icon: "shield-alert-outline" as const,
    tone: "#FFD17A",
    soft: "rgba(255, 209, 122, 0.16)",
  },
  low: {
    label: "低风险",
    icon: "shield-check-outline" as const,
    tone: "#A8D0FF",
    soft: "rgba(168, 208, 255, 0.16)",
  },
} as const;

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatClock(value: number) {
  const totalSeconds = Math.max(0, Math.round(value));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function FraudDecisionHeroCard({
  decision,
  dynamics,
}: {
  decision: ScamDecision;
  dynamics: ScamDynamics;
}) {
  const meta =
    riskMeta[decision.risk_level as keyof typeof riskMeta] ?? riskMeta.high;
  const lastStage =
    dynamics.stage_sequence[dynamics.stage_sequence.length - 1]?.label ??
    "风险阶段";

  return (
    <View style={styles.card}>
      <View style={styles.glowTop} />
      <View style={styles.glowBottom} />

      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={[styles.badge, { backgroundColor: meta.soft }]}>
            <MaterialCommunityIcons name={meta.icon} size={14} color={meta.tone} />
            <Text style={[styles.badgeText, { color: meta.tone }]}>{meta.label}</Text>
          </View>
          <Text style={styles.title}>{decision.summary || "存在明显操控迹象"}</Text>
          <Text style={styles.subtitle}>当前已推进至“{lastStage}”</Text>
        </View>

        <View style={styles.scoreCard}>
          <Text style={styles.scoreNumber}>
            {Math.round(decision.call_risk_score * 100)}
          </Text>
          <Text style={styles.scoreLabel}>风险分</Text>
        </View>
      </View>

      <View style={styles.metricRow}>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>可信度</Text>
          <Text style={styles.metricValue}>{formatPercent(decision.confidence)}</Text>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>通话时长</Text>
          <Text style={styles.metricValue}>{formatClock(dynamics.total_duration_sec)}</Text>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>阶段数</Text>
          <Text style={styles.metricValue}>{dynamics.stage_sequence.length}</Text>
        </View>
      </View>

      <View style={styles.summaryWrap}>
        <Text style={styles.summaryLabel}>判定依据</Text>
        <Text style={styles.summaryText}>
          {decision.explanation || "已出现连续操控、施压与执行引导。"}
        </Text>
      </View>

      <View style={styles.actionWrap}>
        {decision.suggested_actions.map((item) => (
          <View key={item} style={styles.actionChip}>
            <MaterialCommunityIcons
              name="check-circle-outline"
              size={15}
              color="#8FBCFF"
            />
            <Text style={styles.actionText}>{item}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    overflow: "hidden",
    borderRadius: 28,
    backgroundColor: "#163C71",
    paddingHorizontal: 18,
    paddingVertical: 18,
    gap: 14,
    ...panelShadow,
  },
  glowTop: {
    position: "absolute",
    top: -96,
    right: -18,
    width: 220,
    height: 220,
    borderRadius: 999,
    backgroundColor: "rgba(86, 135, 255, 0.18)",
  },
  glowBottom: {
    position: "absolute",
    bottom: -92,
    left: -44,
    width: 190,
    height: 190,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  headerLeft: {
    flex: 1,
    gap: 8,
  },
  badge: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  badgeText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  title: {
    color: palette.white,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  subtitle: {
    color: "rgba(255,255,255,0.76)",
    fontSize: 12,
    lineHeight: 17,
    fontFamily: fontFamily.body,
  },
  scoreCard: {
    width: 92,
    minHeight: 92,
    borderRadius: 24,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  scoreNumber: {
    color: palette.white,
    fontSize: 30,
    lineHeight: 34,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  scoreLabel: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 11,
    lineHeight: 14,
    fontFamily: fontFamily.body,
  },
  metricRow: {
    flexDirection: "row",
    gap: 10,
  },
  metricCard: {
    flex: 1,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 4,
  },
  metricLabel: {
    color: "rgba(255,255,255,0.68)",
    fontSize: 11,
    lineHeight: 14,
    fontFamily: fontFamily.body,
  },
  metricValue: {
    color: palette.white,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  summaryWrap: {
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 6,
  },
  summaryLabel: {
    color: "#A8D0FF",
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  summaryText: {
    color: palette.white,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  actionWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  actionChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: radius.pill,
    backgroundColor: "rgba(255,255,255,0.08)",
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  actionText: {
    color: palette.white,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
});
