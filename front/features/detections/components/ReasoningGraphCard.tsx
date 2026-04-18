import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";

import { formatRiskScore, getResultRiskScore, sanitizeDisplayText } from "../displayText";
import type { DetectionKagPayload, DetectionResult } from "../types";
import { buildReasoningGraph, getResultDetail } from "../visualization";
import { GraphCanvas } from "./GraphCanvas";

function getKagPayload(result?: DetectionResult | null): DetectionKagPayload | null {
  const detail = getResultDetail(result);
  if (!detail || detail.analysis_mode !== "deep" || !detail.kag?.enabled) {
    return null;
  }
  return detail.kag;
}

export function ReasoningGraphCard({
  result,
  showHeader = true,
  showPath = true,
  graphHeight = 260,
}: {
  result?: DetectionResult | null;
  showHeader?: boolean;
  showPath?: boolean;
  graphHeight?: number;
}) {
  const graph = useMemo(() => buildReasoningGraph(result), [result]);
  const detail = useMemo(() => getResultDetail(result), [result]);
  const kag = useMemo(() => getKagPayload(result), [result]);

  if (!result || !graph) {
    return null;
  }

  const pathLabels = (
    kag?.reasoning_path?.length
      ? kag.reasoning_path
      : graph.highlighted_labels?.length
        ? graph.highlighted_labels
        : detail?.reasoning_path
  ) ?? [];

  const metrics = kag
    ? [
        { label: "评分", value: formatRiskScore(getResultRiskScore(result)) },
        { label: "实体", value: String(kag.entity_count ?? 0) },
        { label: "关系", value: String(kag.relation_count ?? 0) },
        { label: "反证", value: String(kag.counter_signal_count ?? 0) },
      ]
    : [
        { label: "评分", value: formatRiskScore(getResultRiskScore(result)) },
        { label: "可疑", value: String(Array.isArray(detail?.risk_evidence) ? detail.risk_evidence.length : 0) },
        { label: "降险", value: String(Array.isArray(detail?.counter_evidence) ? detail.counter_evidence.length : 0) },
        { label: "检索", value: String(result.retrieved_evidence.length + result.counter_evidence.length) },
      ];

  return (
    <View style={styles.card}>
      {kag ? (
        <LinearGradient
          colors={showHeader ? ["#244C86", "#2F70E6", "#7DA9FF"] : ["#F7FBFF", "#EEF5FF"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.hero, !showHeader && styles.heroCompact]}
        >
          <View style={styles.heroTop}>
            <View style={[styles.modePill, !showHeader && styles.modePillCompact]}>
              <MaterialCommunityIcons
                name="graph-outline"
                size={13}
                color={showHeader ? "#F4F7FF" : palette.accentStrong}
              />
              <Text style={[styles.modePillText, !showHeader && styles.modePillTextCompact]}>KAG 图谱</Text>
            </View>
            {showHeader ? (
              <View style={styles.heroMetricPill}>
                <Text style={styles.heroMetricLabel}>下一步</Text>
                <Text style={styles.heroMetricValue}>
                  {sanitizeDisplayText(kag.predicted_next_step ?? "继续核验")}
                </Text>
              </View>
            ) : null}
          </View>

          <Text style={[styles.heroLabel, !showHeader && styles.heroLabelCompact]}>图谱</Text>
          <Text style={[styles.heroTitle, !showHeader && styles.heroTitleCompact]}>
            {sanitizeDisplayText(kag.current_stage?.label ?? "待判定")}
          </Text>
        </LinearGradient>
      ) : showHeader ? (
        <View style={styles.headerRow}>
          <Text style={styles.title}>推理图</Text>
        </View>
      ) : null}

      <GraphCanvas graph={graph} height={graphHeight} />

      {showPath && pathLabels.length ? (
        <View style={styles.pathRow}>
          {pathLabels.slice(0, 5).map((item, index) => (
            <View key={`${item}-${index}`} style={styles.pathStep}>
              <View style={[styles.pathChip, kag ? styles.pathChipDeep : null]}>
                <Text style={[styles.pathChipText, kag ? styles.pathChipTextDeep : null]}>
                  {sanitizeDisplayText(item)}
                </Text>
              </View>
              {index < Math.min(pathLabels.length, 5) - 1 ? (
                <MaterialCommunityIcons name="arrow-right" size={14} color={palette.inkSoft} />
              ) : null}
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.metricRow}>
        {metrics.map((item) => (
          <View key={`${item.label}-${item.value}`} style={[styles.metricCard, kag ? styles.metricCardDeep : null]}>
            <Text style={styles.metricLabel}>{item.label}</Text>
            <Text style={styles.metricValue}>{item.value}</Text>
          </View>
        ))}
      </View>
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
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  title: {
    color: palette.ink,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  hero: {
    borderRadius: radius.lg,
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 8,
  },
  heroCompact: {
    borderWidth: 1,
    borderColor: "#DCE8FA",
  },
  heroTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },
  modePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  modePillCompact: {
    backgroundColor: "#FFFFFF",
  },
  modePillText: {
    color: "#F4F7FF",
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  modePillTextCompact: {
    color: palette.accentStrong,
  },
  heroMetricPill: {
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: radius.md,
    backgroundColor: "rgba(255,255,255,0.14)",
    gap: 2,
    alignItems: "flex-end",
  },
  heroMetricLabel: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 10,
    lineHeight: 12,
    fontFamily: fontFamily.body,
  },
  heroMetricValue: {
    color: "#FFFFFF",
    fontSize: 13,
    lineHeight: 16,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  heroLabel: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  heroLabelCompact: {
    color: palette.inkSoft,
  },
  heroTitle: {
    color: "#FFFFFF",
    fontSize: 24,
    lineHeight: 29,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  heroTitleCompact: {
    color: palette.ink,
    fontSize: 18,
    lineHeight: 23,
  },
  pathRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  pathStep: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  pathChip: {
    borderRadius: radius.pill,
    backgroundColor: palette.surfaceSoft,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  pathChipDeep: {
    backgroundColor: "#EEF5FF",
  },
  pathChipText: {
    color: palette.accentStrong,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  pathChipTextDeep: {
    color: "#244C86",
  },
  metricRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  metricCard: {
    width: "48.4%",
    borderRadius: radius.md,
    backgroundColor: palette.surfaceSoft,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 4,
  },
  metricCardDeep: {
    backgroundColor: "#F7FBFF",
    borderWidth: 1,
    borderColor: "#E2ECFB",
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
});
