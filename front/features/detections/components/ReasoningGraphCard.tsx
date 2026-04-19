import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";

import { formatRiskScore, getResultRiskScore, sanitizeDisplayText } from "../displayText";
import type { DetectionKagPayload, DetectionResult } from "../types";
import { buildReasoningGraph, getResultDetail } from "../visualization";
import { DeepReasoningStageGraph } from "./DeepReasoningStageGraph";
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
        { label: "链路", value: String(kag.metrics?.chain_score ?? 0) },
        { label: "动作", value: String(kag.metrics?.action_score ?? 0) },
        { label: "支撑", value: String(kag.metrics?.support_score ?? 0) },
        { label: "反证", value: String(kag.metrics?.contradiction_score ?? 0) },
      ]
    : [
        { label: "评分", value: formatRiskScore(getResultRiskScore(result)) },
        { label: "可疑", value: String(Array.isArray(detail?.risk_evidence) ? detail.risk_evidence.length : 0) },
        { label: "降险", value: String(Array.isArray(detail?.counter_evidence) ? detail.counter_evidence.length : 0) },
        { label: "检索", value: String(result.retrieved_evidence.length + result.counter_evidence.length) },
      ];

  return (
    <View style={styles.card}>
      {kag && showHeader ? (
        <View style={styles.deepHeader}>
          <View style={[styles.deepHeaderPill, styles.deepHeaderPillStage]}>
            <MaterialCommunityIcons name="timeline-outline" size={13} color="#2F70E6" />
            <Text style={[styles.deepHeaderPillText, styles.deepHeaderPillTextStage]}>
              {sanitizeDisplayText(kag.current_stage?.label ?? "待判定")}
            </Text>
          </View>
          <View style={[styles.deepHeaderPill, styles.deepHeaderPillNext]}>
            <MaterialCommunityIcons name="arrow-right-circle-outline" size={13} color="#D47C3A" />
            <Text style={[styles.deepHeaderPillText, styles.deepHeaderPillTextNext]}>
              {sanitizeDisplayText(kag.predicted_next_step ?? "继续核验")}
            </Text>
          </View>
        </View>
      ) : showHeader ? (
        <View style={styles.headerRow}>
          <Text style={styles.title}>关系链路</Text>
        </View>
      ) : null}

      {kag ? (
        <DeepReasoningStageGraph kag={kag} height={graphHeight} showPath={showPath} />
      ) : (
        <GraphCanvas graph={graph} height={graphHeight} />
      )}

      {!kag && showPath && pathLabels.length ? (
        <View style={styles.pathRow}>
          {pathLabels.slice(0, 5).map((item, index) => (
            <View key={`${item}-${index}`} style={styles.pathStep}>
              <View style={styles.pathChip}>
                <Text style={styles.pathChipText}>
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
  deepHeader: {
    flexDirection: "row",
    gap: 10,
    flexWrap: "wrap",
  },
  deepHeaderPill: {
    minHeight: 34,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
  },
  deepHeaderPillStage: {
    borderColor: "#D7E6FC",
    backgroundColor: "#F7FBFF",
  },
  deepHeaderPillNext: {
    borderColor: "#F2D9C2",
    backgroundColor: "#FFF7EF",
  },
  deepHeaderPillText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  deepHeaderPillTextStage: {
    color: "#2F70E6",
  },
  deepHeaderPillTextNext: {
    color: "#D47C3A",
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
  pathChipText: {
    color: palette.accentStrong,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    fontFamily: fontFamily.body,
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
