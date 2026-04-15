import { MaterialCommunityIcons } from "@expo/vector-icons";
import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { relationTypeMeta } from "@/features/relations/types";
import type { UserUpload } from "@/features/uploads/types";
import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";

const uploadMeta: Record<
  string,
  { label: string; icon: keyof typeof MaterialCommunityIcons.glyphMap; soft: string; tone: string }
> = {
  text: {
    label: "文本",
    icon: "file-document-outline",
    soft: "rgba(75, 141, 248, 0.12)",
    tone: palette.accentStrong,
  },
  audio: {
    label: "音频",
    icon: "waveform",
    soft: "rgba(43, 163, 240, 0.12)",
    tone: "#2B9CE9",
  },
  image: {
    label: "图片",
    icon: "image-outline",
    soft: "rgba(94, 112, 255, 0.12)",
    tone: "#5E70FF",
  },
  video: {
    label: "视频",
    icon: "video-outline",
    soft: "rgba(140, 98, 255, 0.12)",
    tone: "#8C62FF",
  },
};

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

type Props = {
  item: UserUpload;
  onArchive: () => void;
  onOpenRecord?: (() => void) | undefined;
};

function UploadTimelineCard({ item, onArchive, onOpenRecord }: Props) {
  const meta = uploadMeta[item.upload_type] ?? uploadMeta.text;
  const relationCount = item.bound_relations.length;

  return (
    <View style={styles.card}>
      <View style={styles.topRow}>
        <View style={[styles.iconWrap, { backgroundColor: meta.soft }]}>
          <MaterialCommunityIcons name={meta.icon} size={18} color={meta.tone} />
        </View>

        <View style={styles.copy}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>{meta.label}</Text>
            <Text style={styles.time}>{formatTime(item.created_at)}</Text>
          </View>
          <View style={styles.metricRow}>
            <View style={styles.metricPill}>
              <Text style={styles.metricPillText}>{item.file_count}</Text>
            </View>
            <View style={styles.metricPill}>
              <Text style={styles.metricPillText}>{item.unassigned_file_count}</Text>
            </View>
            <View style={styles.metricPill}>
              <Text style={styles.metricPillText}>{relationCount}</Text>
            </View>
          </View>
        </View>
      </View>

      <View style={styles.fileWrap}>
        {item.file_paths.slice(0, 4).map((path) => (
          <View key={`${item.id}:${path}`} style={styles.fileChip}>
            <Text numberOfLines={1} style={styles.fileChipText}>
              {path.split("/").pop() ?? path}
            </Text>
          </View>
        ))}
        {item.file_paths.length > 4 ? (
          <View style={styles.fileChip}>
            <Text style={styles.fileChipText}>+{item.file_paths.length - 4}</Text>
          </View>
        ) : null}
      </View>

      {item.bound_relations.length ? (
        <View style={styles.bindingWrap}>
          {item.bound_relations.map((binding) => {
            const relationMeta = relationTypeMeta[binding.relation_type as keyof typeof relationTypeMeta];
            return (
              <View
                key={`${item.id}:${binding.relation_profile_id}`}
                style={[
                  styles.bindingChip,
                  { backgroundColor: relationMeta?.soft ?? "rgba(75, 141, 248, 0.12)" },
                ]}
              >
                <Text
                  style={[
                    styles.bindingChipText,
                    { color: relationMeta?.accent ?? palette.accentStrong },
                  ]}
                >
                  {binding.relation_name}
                </Text>
              </View>
            );
          })}
        </View>
      ) : null}

      <View style={styles.actionRow}>
        <Pressable style={({ pressed }) => [styles.actionButton, pressed && styles.buttonPressed]} onPress={onArchive}>
          <MaterialCommunityIcons name="shape-outline" size={16} color={palette.accentStrong} />
          <Text style={styles.actionButtonText}>{relationCount ? "再归档" : "归档"}</Text>
        </Pressable>
        {onOpenRecord ? (
          <Pressable style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]} onPress={onOpenRecord}>
            <MaterialCommunityIcons name="history" size={16} color={palette.inkSoft} />
            <Text style={styles.secondaryButtonText}>{"记录"}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export default memo(UploadTimelineCard);

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 12,
    ...panelShadow,
  },
  topRow: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
  },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  copy: {
    flex: 1,
    gap: 8,
  },
  titleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  title: {
    color: palette.ink,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  time: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fontFamily.body,
  },
  metricRow: {
    flexDirection: "row",
    gap: 8,
  },
  metricPill: {
    minWidth: 38,
    borderRadius: radius.pill,
    backgroundColor: palette.surfaceSoft,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  metricPillText: {
    color: palette.inkSoft,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  fileWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  fileChip: {
    maxWidth: "100%",
    borderRadius: radius.pill,
    backgroundColor: palette.surfaceSoft,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  fileChipText: {
    maxWidth: 240,
    color: palette.ink,
    fontSize: 11,
    lineHeight: 14,
    fontFamily: fontFamily.body,
  },
  bindingWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  bindingChip: {
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  bindingChipText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
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
    backgroundColor: palette.accentSoft,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  actionButtonText: {
    color: palette.accentStrong,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  secondaryButton: {
    minHeight: 42,
    borderRadius: radius.pill,
    backgroundColor: palette.surfaceSoft,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  secondaryButtonText: {
    color: palette.inkSoft,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  buttonPressed: {
    transform: [{ scale: 0.98 }],
  },
});
