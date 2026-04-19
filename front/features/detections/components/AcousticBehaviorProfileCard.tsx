import { StyleSheet, Text, View } from "react-native";

import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";

import type { ScamBehaviorProfile } from "../types";

const metricMeta = [
  { key: "urgency_score", label: "紧迫感", color: "#E56D5D" },
  { key: "dominance_score", label: "控制感", color: "#F09C4A" },
  { key: "command_score", label: "命令性", color: "#5B8DFF" },
  { key: "victim_compliance_score", label: "顺从度", color: "#35A7A1" },
  { key: "speech_pressure_score", label: "压迫度", color: "#8C63F6" },
] as const;

function formatPercent(value: number) {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}`;
}

export function AcousticBehaviorProfileCard({
  profile,
}: {
  profile: ScamBehaviorProfile;
}) {
  const score =
    (profile.urgency_score +
      profile.dominance_score +
      profile.command_score +
      profile.victim_compliance_score +
      profile.speech_pressure_score) /
    5;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>声学行为画像</Text>
          <Text style={styles.caption}>五维拆解</Text>
        </View>
        <View style={styles.scoreBadge}>
          <Text style={styles.scoreValue}>{formatPercent(score)}</Text>
          <Text style={styles.scoreLabel}>总分</Text>
        </View>
      </View>

      <View style={styles.metricList}>
        {metricMeta.map((item) => {
          const value = profile[item.key];
          return (
            <View key={item.key} style={styles.metricRow}>
              <View style={styles.metricTop}>
                <Text style={styles.metricLabel}>{item.label}</Text>
                <Text style={styles.metricValue}>{formatPercent(value)}</Text>
              </View>
              <View style={styles.barTrack}>
                <View
                  style={[
                    styles.barFill,
                    {
                      width: `${Math.max(6, Math.round(Math.max(0, Math.min(1, value)) * 100))}%`,
                      backgroundColor: item.color,
                    },
                  ]}
                />
              </View>
            </View>
          );
        })}
      </View>

      <View style={styles.summaryWrap}>
        <Text style={styles.summaryLabel}>画像摘要</Text>
        <Text style={styles.summaryText}>{profile.summary || "暂无画像摘要"}</Text>
      </View>
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
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  title: {
    color: palette.ink,
    fontSize: 19,
    lineHeight: 24,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  caption: {
    color: palette.accentStrong,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  scoreBadge: {
    minWidth: 74,
    borderRadius: 20,
    backgroundColor: palette.surfaceSoft,
    borderWidth: 1,
    borderColor: palette.line,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  scoreValue: {
    color: palette.ink,
    fontSize: 24,
    lineHeight: 28,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  scoreLabel: {
    color: palette.inkSoft,
    fontSize: 11,
    lineHeight: 14,
    fontFamily: fontFamily.body,
  },
  metricList: {
    gap: 10,
  },
  metricRow: {
    gap: 6,
  },
  metricTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  metricLabel: {
    color: palette.ink,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  metricValue: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  barTrack: {
    height: 10,
    borderRadius: 999,
    backgroundColor: palette.surfaceSoft,
    overflow: "hidden",
  },
  barFill: {
    height: "100%",
    borderRadius: 999,
  },
  summaryWrap: {
    borderRadius: 18,
    backgroundColor: palette.surfaceSoft,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 6,
  },
  summaryLabel: {
    color: palette.accentStrong,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  summaryText: {
    color: palette.ink,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
});
