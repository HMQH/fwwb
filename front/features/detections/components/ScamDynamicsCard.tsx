import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";

import type { ScamDynamics } from "../types";

function formatClock(value: number) {
  const totalSeconds = Math.max(0, Math.round(value));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function ScamDynamicsCard({
  dynamics,
  onOpenTimeline,
  onOpenSegments,
}: {
  dynamics: ScamDynamics;
  onOpenTimeline?: () => void;
  onOpenSegments?: () => void;
}) {
  const totalDuration = Math.max(dynamics.total_duration_sec, 1);
  const moments = dynamics.key_moments.slice(0, 3);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>过程演化</Text>
          <Text style={styles.caption}>阶段链路</Text>
        </View>
        <View style={styles.metaChip}>
          <MaterialCommunityIcons
            name="timeline-text-outline"
            size={14}
            color={palette.accentStrong}
          />
          <Text style={styles.metaChipText}>{dynamics.stage_sequence.length} 段</Text>
        </View>
      </View>

      <View style={styles.stageList}>
        {dynamics.stage_sequence.map((stage) => {
          const widthPercent = Math.max(
            10,
            Math.round(((stage.end_sec - stage.start_sec) / totalDuration) * 100),
          );
          return (
            <View key={stage.id} style={styles.stageItem}>
              <View style={styles.stageTop}>
                <Text style={styles.stageLabel}>{stage.label}</Text>
                <Text style={styles.stageTime}>
                  {formatClock(stage.start_sec)} - {formatClock(stage.end_sec)}
                </Text>
              </View>
              <View style={styles.stageTrack}>
                <View
                  style={[
                    styles.stageFill,
                    {
                      width: `${widthPercent}%`,
                      backgroundColor: stage.color || palette.accentStrong,
                    },
                  ]}
                />
              </View>
              {stage.summary ? <Text style={styles.stageSummary}>{stage.summary}</Text> : null}
            </View>
          );
        })}
      </View>

      {moments.length ? (
        <View style={styles.momentWrap}>
          <Text style={styles.sectionLabel}>关键时刻</Text>
          {moments.map((item) => (
            <View key={item.id} style={styles.momentItem}>
              <View style={styles.momentDot} />
              <View style={styles.momentCopy}>
                <Text style={styles.momentTitle}>
                  {item.label} · {formatClock(item.time_sec)}
                </Text>
                <Text style={styles.momentText}>
                  {item.user_meaning || item.description || item.stage_label || "关键节点"}
                </Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.actionRow}>
        <Pressable
          style={({ pressed }) => [
            styles.actionButton,
            pressed && styles.actionButtonPressed,
          ]}
          onPress={onOpenTimeline}
        >
          <MaterialCommunityIcons
            name="chart-line-variant"
            size={16}
            color={palette.accentStrong}
          />
          <Text style={styles.actionText}>阶段轨迹</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.actionButton,
            pressed && styles.actionButtonPressed,
          ]}
          onPress={onOpenSegments}
        >
          <MaterialCommunityIcons
            name="waveform"
            size={16}
            color={palette.accentStrong}
          />
          <Text style={styles.actionText}>证据片段</Text>
        </Pressable>
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
  metaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: radius.pill,
    backgroundColor: palette.accentSoft,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  metaChipText: {
    color: palette.accentStrong,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  stageList: {
    gap: 12,
  },
  stageItem: {
    gap: 6,
  },
  stageTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  stageLabel: {
    color: palette.ink,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  stageTime: {
    color: palette.inkSoft,
    fontSize: 11,
    lineHeight: 14,
    fontFamily: fontFamily.body,
  },
  stageTrack: {
    height: 12,
    borderRadius: 999,
    backgroundColor: palette.surfaceSoft,
    overflow: "hidden",
  },
  stageFill: {
    height: "100%",
    borderRadius: 999,
  },
  stageSummary: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 17,
    fontFamily: fontFamily.body,
  },
  momentWrap: {
    gap: 8,
  },
  sectionLabel: {
    color: palette.accentStrong,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  momentItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    borderRadius: 18,
    backgroundColor: palette.surfaceSoft,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  momentDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: palette.accentStrong,
    marginTop: 6,
  },
  momentCopy: {
    flex: 1,
    gap: 4,
  },
  momentTitle: {
    color: palette.ink,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  momentText: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 17,
    fontFamily: fontFamily.body,
  },
  actionRow: {
    flexDirection: "row",
    gap: 10,
  },
  actionButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: radius.pill,
    backgroundColor: palette.surfaceSoft,
    borderWidth: 1,
    borderColor: palette.line,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  actionButtonPressed: {
    opacity: 0.88,
  },
  actionText: {
    color: palette.ink,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
});
