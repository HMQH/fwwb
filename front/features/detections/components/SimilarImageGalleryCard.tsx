import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";

import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";

import type { SimilarImageItem } from "../types";

function openMaybe(url?: string | null) {
  if (!url) {
    return;
  }
  void Linking.openURL(url);
}

function formatMetric(label: string, value?: number | boolean | null) {
  if (typeof value === "boolean") {
    return value ? label : null;
  }
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }
  if (label === "CLIP") {
    return `${label} ${value.toFixed(3)}`;
  }
  if (label === "Hash") {
    return `${label} ${Math.round(value * 100)}%`;
  }
  return `${label} ${Math.round(value)}`;
}

export function SimilarImageGalleryCard({
  items,
  title = "相似图片来源",
}: {
  items: SimilarImageItem[];
  title?: string;
}) {
  if (!items.length) {
    return null;
  }

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {items.map((item) => {
          const metrics = [
            formatMetric("CLIP", item.clip_similarity),
            formatMetric("Hash", item.hash_similarity),
            formatMetric("pHash", item.phash_distance),
            formatMetric("dHash", item.dhash_distance),
            formatMetric("近同图", item.hash_near_duplicate),
          ].filter(Boolean) as string[];

          return (
            <View key={item.id} style={styles.tile}>
              <Pressable
                style={({ pressed }) => [styles.thumbWrap, pressed && styles.pressed]}
                onPress={() => openMaybe(item.source_url ?? item.image_url ?? item.thumbnail_url)}
              >
                {item.thumbnail_url ? (
                  <Image source={{ uri: item.thumbnail_url }} style={styles.image} contentFit="cover" transition={120} />
                ) : (
                  <View style={styles.imageFallback}>
                    <Text style={styles.imageFallbackText}>暂无缩略图</Text>
                  </View>
                )}
              </Pressable>

              <Text style={styles.domain} numberOfLines={1}>
                {item.domain ?? "未知来源"}
              </Text>
              <Text style={styles.itemTitle} numberOfLines={2}>
                {item.title ?? "未命名候选图"}
              </Text>

              {metrics.length ? (
                <View style={styles.metricWrap}>
                  {metrics.map((metric) => (
                    <View key={metric} style={styles.metricChip}>
                      <Text style={styles.metricChipText}>{metric}</Text>
                    </View>
                  ))}
                </View>
              ) : null}

              <View style={styles.actions}>
                {item.source_url ? (
                  <Pressable style={({ pressed }) => [styles.linkChip, pressed && styles.pressed]} onPress={() => openMaybe(item.source_url)}>
                    <Text style={styles.linkChipText}>打开来源</Text>
                  </Pressable>
                ) : null}
                {item.image_url && item.image_url !== item.source_url ? (
                  <Pressable style={({ pressed }) => [styles.secondaryChip, pressed && styles.pressed]} onPress={() => openMaybe(item.image_url)}>
                    <Text style={styles.secondaryChipText}>查看图片</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          );
        })}
      </ScrollView>
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
  header: { gap: 4 },
  title: {
    color: palette.ink,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  row: {
    gap: 12,
    paddingRight: 8,
  },
  tile: {
    width: 192,
    borderRadius: radius.md,
    backgroundColor: palette.surfaceSoft,
    borderWidth: 1,
    borderColor: palette.line,
    padding: 10,
    gap: 8,
  },
  thumbWrap: {
    borderRadius: radius.md,
    overflow: "hidden",
  },
  image: {
    width: "100%",
    aspectRatio: 1.05,
    backgroundColor: palette.backgroundDeep,
  },
  imageFallback: {
    width: "100%",
    aspectRatio: 1.05,
    backgroundColor: palette.backgroundDeep,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  imageFallbackText: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
    fontFamily: fontFamily.body,
  },
  domain: {
    color: palette.accentStrong,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  itemTitle: {
    color: palette.ink,
    fontSize: 13,
    lineHeight: 19,
    fontFamily: fontFamily.body,
    minHeight: 38,
  },
  metricWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  metricChip: {
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 5,
    backgroundColor: palette.backgroundDeep,
  },
  metricChipText: {
    color: palette.inkSoft,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: "auto",
  },
  linkChip: {
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: palette.accentSoft,
  },
  linkChipText: {
    color: palette.accentStrong,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  secondaryChip: {
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
  },
  secondaryChipText: {
    color: palette.inkSoft,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  pressed: {
    transform: [{ scale: 0.98 }],
  },
});
