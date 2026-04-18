import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { StyleSheet, Text, View } from "react-native";

import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";

import { formatRiskScore, getResultRiskScore, sanitizeDisplayText } from "../displayText";
import type { DetectionKagPayload, DetectionResult } from "../types";
import { getResultDetail } from "../visualization";

function getKagPayload(result?: DetectionResult | null): DetectionKagPayload | null {
  const detail = getResultDetail(result);
  if (!detail || detail.analysis_mode !== "deep" || !detail.kag) {
    return null;
  }
  return detail.kag;
}

function clampPercent(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0;
  }
  const normalized = value >= 0 && value <= 1 ? value * 100 : value;
  return Math.max(0, Math.min(100, Math.round(normalized)));
}

export function KagSummaryCard({ result }: { result?: DetectionResult | null }) {
  const kag = getKagPayload(result);
  if (!result || !kag?.enabled) {
    return null;
  }

  const currentStage = sanitizeDisplayText(kag.current_stage?.label ?? "待判定");
  const nextStep = sanitizeDisplayText(kag.predicted_next_step ?? "继续核验");
  const trajectory = (kag.reasoning_path?.length ? kag.reasoning_path : kag.trajectory ?? [])
    .map((item) => sanitizeDisplayText(String(item)))
    .filter(Boolean)
    .slice(0, 5);
  const stageScores = (kag.stage_scores ?? []).slice(0, 5);
  const relations = (kag.key_relations ?? []).map((item) => sanitizeDisplayText(item)).filter(Boolean).slice(0, 4);
  const focus = (kag.intervention_focus ?? []).map((item) => sanitizeDisplayText(item)).filter(Boolean).slice(0, 4);

  return (
    <View style={styles.card}>
      <LinearGradient
        colors={["#244C86", "#2F70E6", "#6F9EFF"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.hero}
      >
        <View style={styles.heroTop}>
          <View style={styles.modePill}>
            <MaterialCommunityIcons name="graph-outline" size={14} color="#F5F8FF" />
            <Text style={styles.modePillText}>KAG</Text>
          </View>
          <View style={styles.scorePill}>
            <Text style={styles.scorePillLabel}>评分</Text>
            <Text style={styles.scorePillValue}>{formatRiskScore(getResultRiskScore(result))}</Text>
          </View>
        </View>

        <Text style={styles.heroLabel}>当前阶段</Text>
        <Text style={styles.heroTitle}>{currentStage}</Text>

        {trajectory.length ? (
          <View style={styles.trajectoryRow}>
            {trajectory.map((item, index) => (
              <View key={`${item}-${index}`} style={styles.trajectoryChip}>
                <Text style={styles.trajectoryChipText}>{item}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </LinearGradient>

      <View style={styles.body}>
        <View style={styles.nextCard}>
          <Text style={styles.sectionLabel}>下一步</Text>
          <Text style={styles.nextValue}>{nextStep}</Text>
        </View>

        <View style={styles.metricRow}>
          <View style={styles.metricChip}>
            <Text style={styles.metricLabel}>实体</Text>
            <Text style={styles.metricValue}>{kag.entity_count ?? 0}</Text>
          </View>
          <View style={styles.metricChip}>
            <Text style={styles.metricLabel}>关系</Text>
            <Text style={styles.metricValue}>{kag.relation_count ?? 0}</Text>
          </View>
          <View style={styles.metricChip}>
            <Text style={styles.metricLabel}>反证</Text>
            <Text style={styles.metricValue}>{kag.counter_signal_count ?? 0}</Text>
          </View>
        </View>

        {stageScores.length ? (
          <View style={styles.stageBoard}>
            {stageScores.map((item) => {
              const width = `${Math.max(12, clampPercent(item.score))}%` as const;
              return (
                <View key={item.code} style={[styles.stageRow, item.active && styles.stageRowActive]}>
                  <View style={styles.stageRowTop}>
                    <Text style={styles.stageName}>{sanitizeDisplayText(item.label)}</Text>
                    <Text style={styles.stageScore}>{clampPercent(item.score)}</Text>
                  </View>
                  <View style={styles.stageTrack}>
                    <View style={[styles.stageFill, { width }, item.active && styles.stageFillActive]} />
                  </View>
                </View>
              );
            })}
          </View>
        ) : null}

        {relations.length ? (
          <View style={styles.block}>
            <Text style={styles.sectionLabel}>关系</Text>
            <View style={styles.chipWrap}>
              {relations.map((item) => (
                <View key={item} style={[styles.tagChip, styles.relationChip]}>
                  <Text style={[styles.tagChipText, styles.relationChipText]}>{item}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {focus.length ? (
          <View style={styles.block}>
            <Text style={styles.sectionLabel}>聚焦</Text>
            <View style={styles.chipWrap}>
              {focus.map((item) => (
                <View key={item} style={[styles.tagChip, styles.focusChip]}>
                  <Text style={[styles.tagChipText, styles.focusChipText]}>{item}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.xl,
    overflow: "hidden",
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: "#D2E2FA",
    ...panelShadow,
  },
  hero: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 16,
    gap: 10,
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
  modePillText: {
    color: "#F5F8FF",
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "900",
    letterSpacing: 0.3,
    fontFamily: fontFamily.body,
  },
  scorePill: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.md,
    backgroundColor: "rgba(255,255,255,0.14)",
    alignItems: "flex-end",
    gap: 2,
  },
  scorePillLabel: {
    color: "rgba(255,255,255,0.82)",
    fontSize: 10,
    lineHeight: 12,
    fontFamily: fontFamily.body,
  },
  scorePillValue: {
    color: "#FFFFFF",
    fontSize: 16,
    lineHeight: 18,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  heroLabel: {
    color: "rgba(255,255,255,0.76)",
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  heroTitle: {
    color: "#FFFFFF",
    fontSize: 26,
    lineHeight: 32,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  trajectoryRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  trajectoryChip: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  trajectoryChipText: {
    color: "#F4F7FF",
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  body: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 18,
    gap: 14,
  },
  nextCard: {
    borderRadius: radius.lg,
    backgroundColor: "#F4F8FF",
    borderWidth: 1,
    borderColor: "#DCE9FF",
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 8,
  },
  sectionLabel: {
    color: palette.inkSoft,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  nextValue: {
    color: palette.ink,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  metricRow: {
    flexDirection: "row",
    gap: 10,
  },
  metricChip: {
    flex: 1,
    borderRadius: radius.md,
    backgroundColor: "#FAFCFF",
    borderWidth: 1,
    borderColor: "#E1EBFA",
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
    fontSize: 20,
    lineHeight: 24,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  stageBoard: {
    gap: 10,
  },
  stageRow: {
    borderRadius: radius.md,
    backgroundColor: "#F8FBFF",
    borderWidth: 1,
    borderColor: "#E4EDFB",
    paddingHorizontal: 12,
    paddingVertical: 11,
    gap: 8,
  },
  stageRowActive: {
    backgroundColor: "#EEF5FF",
    borderColor: "#BFD5FA",
  },
  stageRowTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  stageName: {
    color: palette.ink,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  stageScore: {
    color: palette.accentStrong,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  stageTrack: {
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: "#E3ECFA",
    overflow: "hidden",
  },
  stageFill: {
    height: "100%",
    borderRadius: radius.pill,
    backgroundColor: "#8FB4FF",
  },
  stageFillActive: {
    backgroundColor: "#2F70E6",
  },
  block: {
    gap: 8,
  },
  chipWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  tagChip: {
    borderRadius: radius.pill,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  relationChip: {
    backgroundColor: "#EEF5FF",
  },
  focusChip: {
    backgroundColor: "#FFF1E8",
  },
  tagChipText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  relationChipText: {
    color: "#2F70E6",
  },
  focusChipText: {
    color: "#D96A4A",
  },
});
