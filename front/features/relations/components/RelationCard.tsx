import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { relationTypeMeta, type RelationProfileSummary } from "@/features/relations/types";
import { resolveApiFileUrl } from "@/shared/api";
import { fontFamily, palette } from "@/shared/theme";
import { ManagedImage as Image } from "@/shared/ui/ManagedImage";

type Props = {
  relation: RelationProfileSummary;
  size: number;
  onPress: () => void;
};

const METRIC_ICON_SIZE = 12;

export default function RelationCard({ relation, size, onPress }: Props) {
  const meta = relationTypeMeta[relation.relation_type];
  const avatarUri = resolveApiFileUrl(relation.avatar_url);
  const metrics = [
    {
      key: "files",
      icon: "image-multiple-outline" as const,
      value: relation.bound_file_count,
    },
    {
      key: "short",
      icon: "clock-fast" as const,
      value: relation.short_term_count,
    },
    {
      key: "long",
      icon: "history" as const,
      value: relation.long_term_count,
    },
  ];

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.wrap,
        {
          width: size,
          height: size,
        },
        pressed && styles.buttonPressed,
      ]}
    >
      <View style={[styles.card, { borderColor: `${meta.accent}2C`, backgroundColor: meta.soft }]}>
        <View style={styles.topRow}>
          {avatarUri ? (
            <Image source={{ uri: avatarUri }} style={styles.avatar} contentFit="cover" imagePreset="avatar" />
          ) : (
            <View style={[styles.avatarFallback, { backgroundColor: palette.surface }]}>
              <MaterialCommunityIcons
                name={meta.icon as keyof typeof MaterialCommunityIcons.glyphMap}
                size={18}
                color={meta.accent}
              />
            </View>
          )}

          <View style={[styles.typeBadge, { borderColor: `${meta.accent}28`, backgroundColor: palette.surface }]}>
            <Text style={[styles.typeBadgeText, { color: meta.accent }]} numberOfLines={1}>
              {meta.label}
            </Text>
          </View>
        </View>

        <View style={styles.body}>
          <Text style={styles.name} numberOfLines={1}>
            {relation.name}
          </Text>
        </View>

        <View style={styles.metricRow}>
          {metrics.map((item) => (
            <View key={item.key} style={styles.metricCell}>
              <MaterialCommunityIcons name={item.icon} size={METRIC_ICON_SIZE} color={palette.inkSoft} />
              <Text style={styles.metricValue} numberOfLines={1}>
                {item.value}
              </Text>
            </View>
          ))}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    overflow: "hidden",
  },
  card: {
    flex: 1,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 8,
    justifyContent: "space-between",
    gap: 6,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
  },
  avatar: {
    width: 32,
    height: 32,
    backgroundColor: palette.backgroundDeep,
  },
  avatarFallback: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: palette.line,
  },
  typeBadge: {
    maxWidth: "64%",
    minHeight: 20,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  typeBadgeText: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  body: {
    flex: 1,
    justifyContent: "flex-end",
  },
  name: {
    color: palette.ink,
    fontSize: 13,
    lineHeight: 16,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  metricRow: {
    flexDirection: "row",
    gap: 2,
  },
  metricCell: {
    flex: 1,
    minHeight: 22,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
  },
  metricValue: {
    color: palette.ink,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  buttonPressed: {
    opacity: 0.92,
  },
});
