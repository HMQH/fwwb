import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";

import type { ScamEvidenceSegment } from "../types";

function formatClock(value: number) {
  const totalSeconds = Math.max(0, Math.round(value));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function riskColor(score: number) {
  if (score >= 0.8) return "#E56D5D";
  if (score >= 0.55) return "#F09C4A";
  return palette.accentStrong;
}

export function EvidenceSegmentsCard({
  segments,
  onOpenAll,
  limit = 3,
}: {
  segments: ScamEvidenceSegment[];
  onOpenAll?: () => void;
  limit?: number;
}) {
  const visible = segments.slice(0, limit);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>风险证据</Text>
          <Text style={styles.caption}>{segments.length} 段</Text>
        </View>
        {segments.length > limit ? (
          <Pressable
            style={({ pressed }) => [styles.moreButton, pressed && styles.moreButtonPressed]}
            onPress={onOpenAll}
          >
            <Text style={styles.moreText}>查看全部</Text>
            <MaterialCommunityIcons
              name="chevron-right"
              size={16}
              color={palette.accentStrong}
            />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.list}>
        {visible.map((item) => {
          const tone = riskColor(item.risk_score);
          return (
            <View key={item.id} style={styles.itemCard}>
              <View style={styles.itemTop}>
                <View style={styles.itemTitleWrap}>
                  <View style={[styles.itemDot, { backgroundColor: tone }]} />
                  <Text style={styles.itemTitle}>{item.stage_label}</Text>
                </View>
                <Text style={styles.itemMeta}>
                  {formatClock(item.start_sec)} - {formatClock(item.end_sec)}
                </Text>
              </View>

              <Text style={styles.transcript}>{item.transcript_excerpt}</Text>

              <View style={styles.tagWrap}>
                {[...item.audio_tags, ...item.semantic_tags].slice(0, 4).map((tag) => (
                  <View key={`${item.id}-${tag}`} style={styles.tagChip}>
                    <Text style={styles.tagText}>{tag}</Text>
                  </View>
                ))}
              </View>

              <Text style={styles.explanation}>
                {item.explanation || "该片段已形成明确风险信号。"}
              </Text>
            </View>
          );
        })}
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
  moreButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  moreButtonPressed: {
    opacity: 0.88,
  },
  moreText: {
    color: palette.accentStrong,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  list: {
    gap: 10,
  },
  itemCard: {
    borderRadius: 20,
    backgroundColor: palette.surfaceSoft,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 8,
  },
  itemTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  itemTitleWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
  },
  itemDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
  },
  itemTitle: {
    color: palette.ink,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  itemMeta: {
    color: palette.inkSoft,
    fontSize: 11,
    lineHeight: 14,
    fontFamily: fontFamily.body,
  },
  transcript: {
    color: palette.ink,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  tagWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  tagChip: {
    borderRadius: radius.pill,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  tagText: {
    color: palette.inkSoft,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  explanation: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 17,
    fontFamily: fontFamily.body,
  },
});
