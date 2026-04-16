import { MaterialCommunityIcons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

import type { UserUpload } from "@/features/uploads/types";
import { fontFamily, palette, radius } from "@/shared/theme";

const iconMap: Record<string, keyof typeof MaterialCommunityIcons.glyphMap> = {
  text: "file-document-outline",
  audio: "waveform",
  image: "image-outline",
  video: "video-outline",
};

type Props = {
  item: UserUpload;
  selected: boolean;
  onSelect: (uploadId: string) => void;
  onHoverPoint: (x: number, y: number) => void;
  onDropPoint: (uploadId: string, x: number, y: number) => void;
};

export default function DraggableUploadChip({
  item,
  selected,
  onSelect,
  onHoverPoint,
  onDropPoint,
}: Props) {
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const active = useSharedValue(0);

  const dragGesture = Gesture.Pan()
    .activateAfterLongPress(180)
    .onBegin(() => {
      active.value = withSpring(1, { damping: 16, stiffness: 180 });
      runOnJS(onSelect)(item.id);
    })
    .onUpdate((event) => {
      translateX.value = event.translationX;
      translateY.value = event.translationY;
      runOnJS(onHoverPoint)(event.absoluteX, event.absoluteY);
    })
    .onEnd((event) => {
      runOnJS(onDropPoint)(item.id, event.absoluteX, event.absoluteY);
    })
    .onFinalize(() => {
      active.value = withSpring(0, { damping: 16, stiffness: 180 });
      translateX.value = withSpring(0, { damping: 16, stiffness: 180 });
      translateY.value = withSpring(0, { damping: 16, stiffness: 180 });
      runOnJS(onHoverPoint)(-1, -1);
    });

  const tapGesture = Gesture.Tap().onEnd(() => {
    runOnJS(onSelect)(item.id);
  });

  const gesture = Gesture.Exclusive(dragGesture, tapGesture);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: interpolate(active.value, [0, 1], [1, 1.05]) },
    ],
    zIndex: active.value > 0 ? 40 : 1,
    shadowOpacity: interpolate(active.value, [0, 1], [0.08, 0.22]),
    shadowRadius: interpolate(active.value, [0, 1], [8, 18]),
    elevation: active.value > 0 ? 18 : 2,
  }));

  const icon = iconMap[item.upload_type] ?? "file-outline";

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        style={[
          styles.card,
          selected && styles.cardSelected,
          animatedStyle,
        ]}
      >
        <View style={styles.iconWrap}>
          <MaterialCommunityIcons name={icon} size={17} color={palette.accentStrong} />
        </View>
        <View style={styles.copy}>
          <Text style={styles.title} numberOfLines={1}>
            {item.file_paths[0]?.split("/").pop() ?? item.storage_batch_id}
          </Text>
          <Text style={styles.caption} numberOfLines={1}>
            {item.file_count} 个 · 待归档 {item.unassigned_file_count}
          </Text>
        </View>
        <View style={styles.dragHint}>
          <MaterialCommunityIcons name="drag" size={16} color={palette.lineStrong} />
        </View>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 156,
    minHeight: 72,
    borderRadius: radius.md,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    shadowColor: "#ABC9F4",
    shadowOffset: { width: 0, height: 8 },
  },
  cardSelected: {
    borderColor: palette.accentStrong,
    backgroundColor: "rgba(255,255,255,0.98)",
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: palette.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  copy: {
    flex: 1,
    gap: 4,
  },
  title: {
    color: palette.ink,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  caption: {
    color: palette.inkSoft,
    fontSize: 11,
    lineHeight: 14,
    fontFamily: fontFamily.body,
  },
  dragHint: {
    width: 20,
    alignItems: "center",
  },
});
