import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import type { RelationProfileSummary } from "@/features/relations/types";
import { relationTypeMeta } from "@/features/relations/types";
import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";

type Props = {
  relation: RelationProfileSummary;
  hovered: boolean;
  onPress: () => void;
};

export default function RelationDropCard({ relation, hovered, onPress }: Props) {
  const hoverValue = useSharedValue(0);
  const meta = relationTypeMeta[relation.relation_type];

  useEffect(() => {
    hoverValue.value = withTiming(hovered ? 1 : 0, { duration: 180 });
  }, [hoverValue, hovered]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: hovered ? 1.02 : 1 }],
    borderColor: hovered ? meta.accent : palette.line,
    backgroundColor: hovered ? "rgba(255,255,255,0.98)" : palette.surface,
  }));

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.wrap, pressed && styles.buttonPressed]}>
      <Animated.View style={[styles.card, animatedStyle]}>
        <View style={styles.topRow}>
          <View style={[styles.iconWrap, { backgroundColor: meta.soft }]}>
            <MaterialCommunityIcons
              name={meta.icon as keyof typeof MaterialCommunityIcons.glyphMap}
              size={18}
              color={meta.accent}
            />
          </View>
          <View style={styles.topCopy}>
            <Text style={styles.name} numberOfLines={1}>
              {relation.name}
            </Text>
            <Text style={[styles.type, { color: meta.accent }]}>{meta.label}</Text>
          </View>
        </View>

        <View style={styles.metricRow}>
          <View style={styles.metricCard}>
            <Text style={styles.metricValue}>{relation.short_term_count}</Text>
            <Text style={styles.metricLabel}>{"短"}</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricValue}>{relation.long_term_count}</Text>
            <Text style={styles.metricLabel}>{"长"}</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricValue}>{relation.bound_file_count}</Text>
            <Text style={styles.metricLabel}>{"文件"}</Text>
          </View>
        </View>

        {relation.tags.length ? (
          <View style={styles.tagRow}>
            {relation.tags.slice(0, 3).map((tag) => (
              <View key={`${relation.id}:${tag}`} style={styles.tagChip}>
                <Text style={styles.tagChipText}>{tag}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
  },
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 12,
    minHeight: 150,
    ...panelShadow,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  topCopy: {
    flex: 1,
    gap: 4,
  },
  name: {
    color: palette.ink,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  type: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  metricRow: {
    flexDirection: "row",
    gap: 8,
  },
  metricCard: {
    flex: 1,
    borderRadius: radius.md,
    backgroundColor: palette.surfaceSoft,
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 4,
  },
  metricValue: {
    color: palette.ink,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  metricLabel: {
    color: palette.inkSoft,
    fontSize: 11,
    lineHeight: 14,
    fontFamily: fontFamily.body,
  },
  tagRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  tagChip: {
    borderRadius: radius.pill,
    backgroundColor: palette.accentSoft,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  tagChipText: {
    color: palette.accentStrong,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  buttonPressed: {
    transform: [{ scale: 0.98 }],
  },
});
