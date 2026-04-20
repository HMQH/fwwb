import { useState } from "react";
import { Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";
import { ManagedImage as Image } from "@/shared/ui/ManagedImage";

import type { SimilarImageItem } from "../types";

function openMaybe(url?: string | null) {
  if (!url) {
    return;
  }
  void Linking.openURL(url);
}

function getPreviewUrl(item: SimilarImageItem) {
  return item.image_url ?? item.thumbnail_url ?? null;
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

function getStatusMeta(item: SimilarImageItem) {
  if (item.is_validated) {
    return {
      label: "已确认",
      soft: palette.accentSoft,
      tone: palette.accentStrong,
    };
  }
  if (item.hash_near_duplicate || item.clip_high_similarity) {
    return {
      label: "高相似",
      soft: "#FFF1E9",
      tone: "#C1664A",
    };
  }
  return null;
}

export function SimilarImageGalleryCard({
  items,
  title = "相似图片来源",
  onRailTouchStart,
  onRailTouchEnd,
}: {
  items: SimilarImageItem[];
  title?: string;
  onRailTouchStart?: () => void;
  onRailTouchEnd?: () => void;
}) {
  const [previewing, setPreviewing] = useState<SimilarImageItem | null>(null);

  if (!items.length) {
    return null;
  }

  const previewUrl = previewing ? getPreviewUrl(previewing) : null;

  return (
    <>
      <View style={styles.card}>
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
        </View>

        <ScrollView
          horizontal
          nestedScrollEnabled
          directionalLockEnabled
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.row}
          onTouchStart={onRailTouchStart}
          onTouchEnd={onRailTouchEnd}
          onTouchCancel={onRailTouchEnd}
          onScrollBeginDrag={onRailTouchStart}
          onScrollEndDrag={onRailTouchEnd}
          onMomentumScrollEnd={onRailTouchEnd}
          scrollEventThrottle={16}
        >
          {items.map((item) => {
            const imageUrl = getPreviewUrl(item);
            const statusMeta = getStatusMeta(item);
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
                  onPress={() => {
                    if (imageUrl) {
                      setPreviewing(item);
                      return;
                    }
                    openMaybe(item.source_url ?? item.image_url ?? item.thumbnail_url ?? null);
                  }}
                >
                  {imageUrl ? (
                    <Image source={{ uri: imageUrl }} style={styles.image} contentFit="cover" imagePreset="tile" transition={120} />
                  ) : (
                    <View style={styles.imageFallback}>
                      <Text style={styles.imageFallbackText}>暂无缩略图</Text>
                    </View>
                  )}
                </Pressable>

                <View style={styles.metaRow}>
                  <Text style={styles.domain} numberOfLines={1}>
                    {item.domain ?? "未知来源"}
                  </Text>
                  {statusMeta ? (
                    <View style={[styles.statusChip, { backgroundColor: statusMeta.soft }]}>
                      <Text style={[styles.statusChipText, { color: statusMeta.tone }]}>{statusMeta.label}</Text>
                    </View>
                  ) : null}
                </View>

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
                  {imageUrl ? (
                    <Pressable style={({ pressed }) => [styles.secondaryChip, pressed && styles.pressed]} onPress={() => setPreviewing(item)}>
                      <Text style={styles.secondaryChipText}>查看大图</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            );
          })}
        </ScrollView>
      </View>

      <Modal
        visible={Boolean(previewing)}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setPreviewing(null)}
      >
        <View style={styles.previewBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setPreviewing(null)} />
          <View style={styles.previewCard}>
            <View style={styles.previewHeader}>
              <View style={styles.previewTitleWrap}>
                <Text style={styles.previewTitle} numberOfLines={2}>
                  {previewing?.title ?? previewing?.domain ?? "图片预览"}
                </Text>
                {previewing?.domain ? (
                  <Text style={styles.previewMeta} numberOfLines={1}>
                    {previewing.domain}
                  </Text>
                ) : null}
              </View>
              <Pressable style={({ pressed }) => [styles.previewClose, pressed && styles.pressed]} onPress={() => setPreviewing(null)}>
                <Text style={styles.previewCloseText}>关闭</Text>
              </Pressable>
            </View>

            {previewUrl ? (
              <Image source={{ uri: previewUrl }} style={styles.previewImage} contentFit="contain" imagePreset="detail" transition={120} />
            ) : null}

            <View style={styles.previewActions}>
              {previewing?.source_url ? (
                <Pressable style={({ pressed }) => [styles.linkChip, pressed && styles.pressed]} onPress={() => openMaybe(previewing.source_url)}>
                  <Text style={styles.linkChipText}>打开来源</Text>
                </Pressable>
              ) : null}
              {previewing?.image_url ? (
                <Pressable style={({ pressed }) => [styles.secondaryChip, pressed && styles.pressed]} onPress={() => openMaybe(previewing.image_url)}>
                  <Text style={styles.secondaryChipText}>打开原图</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        </View>
      </Modal>
    </>
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
    flex: 1,
    color: palette.accentStrong,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
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
  statusChip: {
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  statusChipText: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: "800",
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
  previewBackdrop: {
    flex: 1,
    backgroundColor: "rgba(11, 21, 44, 0.78)",
    paddingHorizontal: 18,
    paddingVertical: 36,
    justifyContent: "center",
  },
  previewCard: {
    borderRadius: radius.lg,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    padding: 14,
    gap: 12,
    ...panelShadow,
  },
  previewHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  previewTitleWrap: {
    flex: 1,
    gap: 4,
  },
  previewTitle: {
    color: palette.ink,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  previewMeta: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fontFamily.body,
  },
  previewClose: {
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: palette.backgroundDeep,
  },
  previewCloseText: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  previewImage: {
    width: "100%",
    height: 360,
    borderRadius: radius.md,
    backgroundColor: palette.backgroundDeep,
  },
  previewActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
});
