import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { type ReactNode, useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { FadeInDown, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue } from "react-native-reanimated";

import { getResultHeadline, getRiskMeta } from "@/features/detections";
import type { RecordHistoryItem } from "@/features/records/types";
import { fontFamily, palette, radius } from "@/shared/theme";
import { useReduceMotionEnabled } from "@/shared/useReduceMotionEnabled";

function clamp(value: number, min: number, max: number) {
  "worklet";
  return Math.min(Math.max(value, min), max);
}

function formatDateTime(value?: string | null) {
  if (!value) {
    return "--";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function statusLabel(item: RecordHistoryItem) {
  const status = item.latest_job?.status;
  if (status === "pending") {
    return "排队中";
  }
  if (status === "running") {
    return "分析中";
  }
  if (status === "failed") {
    return "失败";
  }
  return item.latest_result ? "已完成" : "已提交";
}

type AnimatedListProps = {
  items: RecordHistoryItem[];
  headerContent?: ReactNode;
  onItemSelect?: (item: RecordHistoryItem, index: number) => void;
  showGradients?: boolean;
  displayScrollbar?: boolean;
  initialSelectedIndex?: number;
};

type AnimatedRecordRowProps = {
  item: RecordHistoryItem;
  index: number;
  selected: boolean;
  reduceMotion: boolean;
  onSelect: (item: RecordHistoryItem, index: number) => void;
};

function AnimatedRecordRow({ item, index, selected, reduceMotion, onSelect }: AnimatedRecordRowProps) {
  const meta = getRiskMeta(item.latest_result?.risk_level);
  const entering = reduceMotion ? undefined : FadeInDown.duration(280).delay(Math.min(index, 6) * 50);

  return (
    <Animated.View entering={entering}>
      <Pressable
        style={({ pressed }) => [
          styles.itemCard,
          selected && styles.itemCardSelected,
          pressed && styles.itemCardPressed,
        ]}
        onPress={() => onSelect(item, index)}
      >
        <View style={styles.recordTopRow}>
          <View style={[styles.recordIconWrap, { backgroundColor: meta.soft }]}>
            <MaterialCommunityIcons name={meta.icon} size={20} color={meta.tone} />
          </View>

          <View style={styles.recordCopy}>
            <View style={styles.recordHeaderLine}>
              <Text style={styles.recordTitle} numberOfLines={1}>
                {getResultHeadline(item.latest_result)}
              </Text>
              <Text style={styles.recordTime}>{formatDateTime(item.submission.created_at)}</Text>
            </View>

            <View style={styles.metaLine}>
              <View style={[styles.typePill, { backgroundColor: meta.soft }]}>
                <Text style={[styles.typePillText, { color: meta.tone }]}>{statusLabel(item)}</Text>
              </View>
              {item.latest_result?.need_manual_review ? (
                <View style={styles.neutralPill}>
                  <Text style={styles.neutralPillText}>建议人工复核</Text>
                </View>
              ) : null}
            </View>
          </View>
        </View>

        <Text style={styles.recordDetail} numberOfLines={2}>
          {item.latest_result?.summary ?? item.content_preview ?? "暂无文本摘要"}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

export default function AnimatedList({
  items,
  headerContent,
  onItemSelect,
  showGradients = true,
  displayScrollbar = true,
  initialSelectedIndex = -1,
}: AnimatedListProps) {
  const reduceMotion = useReduceMotionEnabled();
  const [selectedIndex, setSelectedIndex] = useState(initialSelectedIndex);

  const scrollY = useSharedValue(0);
  const containerHeight = useSharedValue(0);
  const contentHeight = useSharedValue(0);

  const onScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollY.value = event.contentOffset.y;
    },
  });

  const topGradientStyle = useAnimatedStyle(() => {
    const hidden = contentHeight.value <= containerHeight.value;
    return {
      opacity: hidden ? 0 : clamp(scrollY.value / 56, 0, 1),
    };
  });

  const bottomGradientStyle = useAnimatedStyle(() => {
    const hidden = contentHeight.value <= containerHeight.value;
    const remaining = contentHeight.value - (scrollY.value + containerHeight.value);
    return {
      opacity: hidden ? 0 : clamp(remaining / 64, 0, 1),
    };
  });

  const handleSelect = useCallback(
    (item: RecordHistoryItem, index: number) => {
      setSelectedIndex(index);
      onItemSelect?.(item, index);
    },
    [onItemSelect]
  );

  return (
    <View style={styles.container}>
      <Animated.FlatList
        data={items}
        keyExtractor={(item) => item.submission.id}
        renderItem={({ item, index }) => (
          <AnimatedRecordRow
            item={item}
            index={index}
            selected={selectedIndex === index}
            reduceMotion={reduceMotion}
            onSelect={handleSelect}
          />
        )}
        ListHeaderComponent={headerContent ? <View style={styles.headerSlot}>{headerContent}</View> : null}
        ItemSeparatorComponent={() => <View style={styles.itemGap} />}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={displayScrollbar}
        scrollEventThrottle={16}
        onScroll={onScroll}
        onLayout={(event) => {
          containerHeight.value = event.nativeEvent.layout.height;
        }}
        onContentSizeChange={(_, height) => {
          contentHeight.value = height;
        }}
      />

      {showGradients ? (
        <>
          <Animated.View pointerEvents="none" style={[styles.topGradientWrap, topGradientStyle]}>
            <LinearGradient
              colors={["rgba(245, 249, 255, 0.96)", "rgba(245, 249, 255, 0.72)", "rgba(245, 249, 255, 0)"]}
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
          <Animated.View pointerEvents="none" style={[styles.bottomGradientWrap, bottomGradientStyle]}>
            <LinearGradient
              colors={["rgba(245, 249, 255, 0)", "rgba(245, 249, 255, 0.78)", "rgba(245, 249, 255, 0.98)"]}
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 28,
  },
  headerSlot: {
    gap: 16,
    marginBottom: 16,
  },
  itemGap: {
    height: 12,
  },
  itemCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.surface,
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 12,
  },
  itemCardSelected: {
    borderColor: palette.accentStrong,
    backgroundColor: palette.surfaceSoft,
  },
  itemCardPressed: {
    transform: [{ scale: 0.985 }],
  },
  recordTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  recordIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  recordCopy: {
    flex: 1,
    gap: 8,
  },
  recordHeaderLine: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  recordTitle: {
    flex: 1,
    color: palette.ink,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  recordTime: {
    color: palette.lineStrong,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  metaLine: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  typePill: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  typePillText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  neutralPill: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: palette.surfaceSoft,
  },
  neutralPillText: {
    color: palette.inkSoft,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  recordDetail: {
    color: palette.inkSoft,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: fontFamily.body,
  },
  topGradientWrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 60,
  },
  bottomGradientWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 96,
  },
});
