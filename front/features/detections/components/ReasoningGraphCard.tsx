import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";

import type { DetectionResult } from "../types";
import { buildReasoningGraph, getResultDetail } from "../visualization";
import { GraphCanvas } from "./GraphCanvas";

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

  if (!result || !graph) {
    return null;
  }
  const pathLabels = (graph.highlighted_labels?.length ? graph.highlighted_labels : detail?.reasoning_path) ?? [];
  const riskBasisCount = Array.isArray(detail?.risk_evidence) ? detail.risk_evidence.length : Number(graph.summary_metrics?.risk_basis_count ?? 0);
  const counterBasisCount = Array.isArray(detail?.counter_evidence) ? detail.counter_evidence.length : Number(graph.summary_metrics?.counter_basis_count ?? 0);
  const metrics = [
    {
      label: "评分",
      value:
        typeof detail?.final_score === "number"
          ? String(Math.round(detail.final_score))
          : typeof result.confidence === "number"
            ? `${Math.round(result.confidence * 100)}`
            : "--",
    },
    {
      label: "可疑",
      value: String(riskBasisCount),
    },
    {
      label: "降险",
      value: String(counterBasisCount),
    },
    {
      label: "检索",
      value: String(result.retrieved_evidence.length + result.counter_evidence.length),
    },
  ];

  return (
    <View style={styles.card}>
      {showHeader ? (
        <View style={styles.headerRow}>
          <Text style={styles.title}>推理图</Text>
        </View>
      ) : null}

      <GraphCanvas graph={graph} height={graphHeight} />

      {showPath && pathLabels.length ? (
        <View style={styles.pathRow}>
          {pathLabels.slice(0, 4).map((item, index) => (
            <View key={`${item}-${index}`} style={styles.pathStep}>
              <View style={styles.pathChip}>
                <Text style={styles.pathChipText}>{item}</Text>
              </View>
              {index < Math.min(pathLabels.length, 4) - 1 ? (
                <MaterialCommunityIcons name="arrow-right" size={14} color={palette.inkSoft} />
              ) : null}
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.metricRow}>
        {metrics.map((item) => (
          <View key={`${item.label}-${item.value}`} style={styles.metricCard}>
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
