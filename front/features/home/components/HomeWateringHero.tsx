import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Image, PanResponder, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import Animated, {
  Easing,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { fontFamily, radius } from "@/shared/theme";
import { useReduceMotionEnabled } from "@/shared/useReduceMotionEnabled";

import type { WateringRewardSource } from "../api";

const SAPLING = require("../../../assets/images/tree/sapling.png");
const MEERKAT_WATERING = require("../../../assets/images/tree/meerkat_watering.png");
const MEERKAT_EYE_OPEN = require("../../../assets/images/tree/meerkat_eyes_open.png");
const MEERKAT_EYE_CLOSED = require("../../../assets/images/tree/meerkat_eyes_closed.png");

const MEERKAT_SIZE = { width: 160, height: 160 };
const TREE_SIZE = { width: 56, height: 68 };
const PENDING_DROP_SIZE = { width: 48, height: 62 };
/** 为左上角分数气泡（64px 高）留出间距；略小于旧值可让狐獴/树上移，给下方卡片腾空间 */
const WRAP_TOP_PADDING = 62;
const HUD_RIGHT_INSET = 14;

const DRAG_TARGET_POINT = { x: 124, y: 112 };
const POUR_SOURCE_POINT = { x: 142, y: 104 };
const POUR_TARGET_POINT = { x: 166, y: 120 };
const DRAG_TARGET_RADIUS = 86;

const MAX_DROPS_FOR_GROWTH = 28;
const GROWTH_PER_DROP = 0.0065;

type CollectResult = {
  source: WateringRewardSource;
  units: number;
} | null;

type HomeWateringHeroProps = {
  score: number;
  baseWaterTotal: number;
  pendingUnits: number;
  onCollectOne: () => Promise<CollectResult>;
  collecting: boolean;
};

function normalizeScore(value: number) {
  if (!Number.isFinite(value)) {
    return 95;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

function resolveScoreTone(score: number) {
  if (score >= 80) {
    return {
      bubbleColor: "rgba(112, 226, 170, 0.24)",
      borderColor: "rgba(225,255,241,0.92)",
      textColor: "#1B8F56",
      shadowColor: "#65D89E",
    };
  }
  if (score >= 60) {
    return {
      bubbleColor: "rgba(255, 207, 126, 0.26)",
      borderColor: "rgba(255,241,219,0.92)",
      textColor: "#C0760E",
      shadowColor: "#FFBF62",
    };
  }
  return {
    bubbleColor: "rgba(255, 151, 151, 0.26)",
    borderColor: "rgba(255,231,231,0.94)",
    textColor: "#CC3C3C",
    shadowColor: "#FF8E8E",
  };
}

type DropUnit = {
  source: WateringRewardSource;
};

export const HomeWateringHero = memo(function HomeWateringHero({
  score,
  baseWaterTotal,
  pendingUnits,
  onCollectOne,
  collecting,
}: HomeWateringHeroProps) {
  const reduceMotion = useReduceMotionEnabled();
  const safeScore = useMemo(() => normalizeScore(score), [score]);
  const scoreTone = useMemo(() => resolveScoreTone(safeScore), [safeScore]);
  const safePendingUnits = Math.max(0, Math.round(Number(pendingUnits) || 0));
  const queuedVisibleCount = Math.min(Math.max(0, safePendingUnits - 1), 9);
  const queuedOverflowCount = Math.max(0, safePendingUnits - 1 - queuedVisibleCount);

  const [waterCount, setWaterCount] = useState(() => Math.max(0, Math.round(baseWaterTotal)));
  const [wrapWidth, setWrapWidth] = useState(0);

  const queueRef = useRef<DropUnit[]>([]);
  const processingRef = useRef(false);
  const draggingClaimRef = useRef(false);
  const processQueueRef = useRef<() => void>(() => {});

  const treeScale = useSharedValue(1);
  const meerkatX = useSharedValue(0);
  const meerkatY = useSharedValue(0);
  const meerkatTilt = useSharedValue(0);
  const meerkatSquash = useSharedValue(1);
  const flightProgress = useSharedValue(0);
  const flightOpacity = useSharedValue(0);
  const pendingFloat = useSharedValue(0);
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);
  const dragActive = useSharedValue(0);
  const eyeBlink = useSharedValue(0);

  useEffect(() => {
    setWaterCount((current) => Math.max(current, Math.max(0, Math.round(baseWaterTotal))));
  }, [baseWaterTotal]);

  useEffect(() => {
    if (reduceMotion) {
      pendingFloat.value = 0;
      return;
    }
    pendingFloat.value = withRepeat(
      withTiming(1, { duration: 1700, easing: Easing.inOut(Easing.quad) }),
      -1,
      true
    );
  }, [pendingFloat, reduceMotion]);

  useEffect(() => {
    eyeBlink.value = withRepeat(
      withSequence(
        withDelay(1900, withTiming(1, { duration: 90, easing: Easing.out(Easing.quad) })),
        withTiming(0, { duration: 120, easing: Easing.out(Easing.quad) }),
        withDelay(2800, withTiming(1, { duration: 80, easing: Easing.out(Easing.quad) })),
        withTiming(0, { duration: 110, easing: Easing.out(Easing.quad) })
      ),
      -1,
      false
    );
  }, [eyeBlink]);

  const growthFactor = Math.min(waterCount, MAX_DROPS_FOR_GROWTH) * GROWTH_PER_DROP;
  const targetScale = 1 + growthFactor;

  useEffect(() => {
    if (reduceMotion) {
      treeScale.value = targetScale;
      return;
    }
    treeScale.value = withSpring(targetScale, { damping: 14, stiffness: 120 });
  }, [reduceMotion, targetScale, treeScale]);

  const treeAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: treeScale.value }],
  }));

  const meerkatAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: meerkatX.value },
      { translateY: meerkatY.value },
      { rotate: `${meerkatTilt.value}deg` },
      { scale: meerkatSquash.value },
    ],
  }));

  const flyingDropStyle = useAnimatedStyle(() => ({
    opacity: flightOpacity.value,
    transform: [
      {
        translateX: interpolate(
          flightProgress.value,
          [0, 1],
          [POUR_SOURCE_POINT.x, POUR_TARGET_POINT.x]
        ),
      },
      {
        translateY: interpolate(
          flightProgress.value,
          [0, 1],
          [POUR_SOURCE_POINT.y, POUR_TARGET_POINT.y]
        ),
      },
      { scale: interpolate(flightProgress.value, [0, 0.82, 1], [0.72, 1.08, 0.56]) },
    ],
  }));

  const pendingDropStyle = useAnimatedStyle(() => ({
    zIndex: interpolate(dragActive.value, [0, 1], [8, 30]),
    transform: [
      { translateX: dragX.value },
      {
        translateY:
          dragY.value +
          interpolate(pendingFloat.value, [0, 1], [0, -6]) * (1 - dragActive.value),
      },
      { scale: collecting ? 0.94 : 1 + dragActive.value * 0.04 },
    ],
    opacity: collecting ? 0.78 : 1,
  }));

  const eyeOpenStyle = useAnimatedStyle(() => ({
    opacity: interpolate(eyeBlink.value, [0, 0.52, 1], [1, 0.16, 0]),
    transform: [
      { translateY: interpolate(eyeBlink.value, [0, 1], [0, 5]) },
      { scaleY: interpolate(eyeBlink.value, [0, 1], [1, 0.12]) },
    ],
  }));

  const eyeClosedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(eyeBlink.value, [0, 0.34, 0.7, 1], [0, 0.18, 0.78, 1]),
    transform: [
      { translateY: interpolate(eyeBlink.value, [0, 1], [-3, 1]) },
      { scaleY: interpolate(eyeBlink.value, [0, 1], [0.75, 1]) },
    ],
  }));

  const playPourMotion = useCallback(() => {
    if (reduceMotion) {
      return;
    }
    const out = { duration: 110, easing: Easing.out(Easing.cubic) };
    meerkatX.value = withSequence(
      withTiming(12, out),
      withSpring(0, { damping: 14, stiffness: 260 })
    );
    meerkatY.value = withSequence(
      withTiming(5, { duration: 95, easing: Easing.out(Easing.quad) }),
      withSpring(0, { damping: 14, stiffness: 280 })
    );
    meerkatTilt.value = withSequence(
      withTiming(6, { duration: 105, easing: Easing.out(Easing.cubic) }),
      withSpring(0, { damping: 15, stiffness: 240 })
    );
    meerkatSquash.value = withSequence(
      withTiming(0.97, { duration: 70, easing: Easing.out(Easing.quad) }),
      withSpring(1, { damping: 12, stiffness: 320 })
    );
  }, [meerkatSquash, meerkatTilt, meerkatX, meerkatY, reduceMotion]);

  const onDropArrived = useCallback(() => {
    flightOpacity.value = withTiming(0, { duration: 120 });
    setWaterCount((count) => count + 1);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    playPourMotion();

    setTimeout(() => {
      processingRef.current = false;
      processQueueRef.current();
    }, reduceMotion ? 120 : 230);
  }, [flightOpacity, playPourMotion, reduceMotion]);

  const processQueue = useCallback(() => {
    if (processingRef.current) {
      return;
    }
    const next = queueRef.current.shift();
    if (!next) {
      return;
    }
    processingRef.current = true;
    flightProgress.value = 0;
    flightOpacity.value = 1;
    if (reduceMotion) {
      flightProgress.value = 1;
      onDropArrived();
      return;
    }
    flightProgress.value = withTiming(
      1,
      {
        duration: 680,
        easing: Easing.inOut(Easing.cubic),
      },
      (finished) => {
        if (finished) {
          runOnJS(onDropArrived)();
        }
      }
    );
  }, [flightOpacity, flightProgress, onDropArrived, reduceMotion]);

  processQueueRef.current = processQueue;

  const enqueueAnimatedDrops = useCallback((source: WateringRewardSource, units: number) => {
    const safeUnits = Math.max(1, Math.min(5, Math.round(Number(units) || 1)));
    for (let index = 0; index < safeUnits; index += 1) {
      queueRef.current.push({ source });
    }
    processQueueRef.current();
  }, []);

  const resetDraggedDropPosition = useCallback(() => {
    dragX.value = withSpring(0, { damping: 18, stiffness: 240 });
    dragY.value = withSpring(0, { damping: 18, stiffness: 240 });
  }, [dragX, dragY]);

  const isDropNearMascot = useCallback(
    (dx: number, dy: number) => {
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
        return false;
      }
      if (wrapWidth <= 0) {
        return dx <= -110 && dy >= 90;
      }
      const startCenterX = wrapWidth - HUD_RIGHT_INSET - PENDING_DROP_SIZE.width / 2;
      const startCenterY = PENDING_DROP_SIZE.height / 2;
      const currentX = startCenterX + dx;
      const currentY = startCenterY + dy;
      const targetX = DRAG_TARGET_POINT.x;
      const targetY = WRAP_TOP_PADDING + DRAG_TARGET_POINT.y;
      return Math.hypot(currentX - targetX, currentY - targetY) <= DRAG_TARGET_RADIUS;
    },
    [wrapWidth]
  );

  const handleDropRelease = useCallback(
    async (dx: number, dy: number) => {
      if (!isDropNearMascot(dx, dy) || safePendingUnits <= 0 || collecting) {
        resetDraggedDropPosition();
        return;
      }
      if (draggingClaimRef.current) {
        resetDraggedDropPosition();
        return;
      }

      draggingClaimRef.current = true;
      try {
        const result = await onCollectOne();
        if (result) {
          enqueueAnimatedDrops(result.source, result.units);
        }
      } finally {
        draggingClaimRef.current = false;
        resetDraggedDropPosition();
      }
    },
    [collecting, enqueueAnimatedDrops, isDropNearMascot, onCollectOne, resetDraggedDropPosition, safePendingUnits]
  );

  const pendingPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => safePendingUnits > 0 && !collecting,
        onMoveShouldSetPanResponder: () => safePendingUnits > 0 && !collecting,
        onPanResponderGrant: () => {
          dragActive.value = withTiming(1, { duration: 120 });
        },
        onPanResponderMove: (_, gesture) => {
          dragX.value = gesture.dx;
          dragY.value = gesture.dy;
        },
        onPanResponderRelease: (_, gesture) => {
          dragActive.value = withTiming(0, { duration: 150 });
          void handleDropRelease(gesture.dx, gesture.dy);
        },
        onPanResponderTerminate: () => {
          dragActive.value = withTiming(0, { duration: 150 });
          resetDraggedDropPosition();
        },
      }),
    [collecting, dragActive, dragX, dragY, handleDropRelease, resetDraggedDropPosition, safePendingUnits]
  );

  const handleWrapLayout = useCallback((event: LayoutChangeEvent) => {
    setWrapWidth(event.nativeEvent.layout.width);
  }, []);

  return (
    <View style={styles.wrap} onLayout={handleWrapLayout}>
      <View style={styles.hudRow}>
        <View
          style={[
            styles.scoreBubble,
            {
              borderColor: scoreTone.borderColor,
              backgroundColor: scoreTone.bubbleColor,
              shadowColor: scoreTone.shadowColor,
            },
          ]}
        >
          <Text style={[styles.scoreValue, { color: scoreTone.textColor }]}>{safeScore}</Text>
        </View>

        {safePendingUnits > 0 ? (
          <View style={styles.pendingHudGroup}>
            {safePendingUnits > 1 ? (
              <View style={styles.pendingQueueWrap}>
                {Array.from({ length: queuedVisibleCount }).map((_, index) => (
                  <View key={`queued-drop-${index}`} style={styles.pendingMiniDrop}>
                    <LinearGradient
                      colors={["rgba(244,253,255,0.88)", "rgba(157,226,255,0.62)", "rgba(108,201,255,0.26)"]}
                      start={{ x: 0.16, y: 0 }}
                      end={{ x: 0.82, y: 1 }}
                      style={styles.pendingMiniGradient}
                    />
                    <View style={styles.pendingMiniHighlight} />
                  </View>
                ))}
                {queuedOverflowCount > 0 ? (
                  <View style={styles.pendingOverflowBadge}>
                    <Text style={styles.pendingOverflowText}>+{queuedOverflowCount}</Text>
                  </View>
                ) : null}
              </View>
            ) : null}

            <Animated.View
              accessibilityRole="adjustable"
              accessibilityLabel="拖动水滴到狐獴浇水"
              accessibilityHint="按住水滴向左下拖动到狐獴"
              {...pendingPanResponder.panHandlers}
              style={[styles.pendingDropWrap, pendingDropStyle]}
            >
              <View style={styles.pendingDrop}>
                <LinearGradient
                  colors={["rgba(242,252,255,0.94)", "rgba(182,231,255,0.72)", "rgba(113,206,255,0.34)"]}
                  start={{ x: 0.18, y: 0 }}
                  end={{ x: 0.85, y: 1 }}
                  style={styles.pendingDropGradient}
                />
                <View style={styles.pendingDropHighlightPrimary} />
                <View style={styles.pendingDropHighlightSecondary} />
                <View style={styles.pendingDropRefract} />
                <View style={styles.pendingDropCoreGlow} />
              </View>
            </Animated.View>
          </View>
        ) : null}
      </View>

      <View style={styles.scene}>
        <View style={styles.meerkatWrap}>
          <Image source={MEERKAT_WATERING} style={styles.meerkatImg} resizeMode="contain" />
          <Animated.View style={[styles.flyingDrop, flyingDropStyle]} />
          <View pointerEvents="none" style={styles.faceEyeOverlay}>
            <View style={[styles.eyeSlot, styles.faceEyeLeft]}>
              <Animated.View style={[styles.eyeLayer, styles.eyeOpenLayer, eyeOpenStyle]}>
                <Image source={MEERKAT_EYE_OPEN} style={styles.eyeOpenImage} resizeMode="contain" />
              </Animated.View>
              <Animated.View style={[styles.eyeLayer, styles.eyeClosedLayer, eyeClosedStyle]}>
                <Image
                  source={MEERKAT_EYE_CLOSED}
                  style={styles.eyeClosedImage}
                  resizeMode="contain"
                />
              </Animated.View>
            </View>
            <View style={[styles.eyeSlot, styles.faceEyeRight, styles.eyeRightMirror]}>
              <Animated.View style={[styles.eyeLayer, styles.eyeOpenLayer, eyeOpenStyle]}>
                <Image source={MEERKAT_EYE_OPEN} style={styles.eyeOpenImage} resizeMode="contain" />
              </Animated.View>
              <Animated.View style={[styles.eyeLayer, styles.eyeClosedLayer, eyeClosedStyle]}>
                <Image
                  source={MEERKAT_EYE_CLOSED}
                  style={styles.eyeClosedImage}
                  resizeMode="contain"
                />
              </Animated.View>
            </View>
          </View>
        </View>

        <View style={styles.treeColumn}>
          <Animated.View style={[styles.treeInner, treeAnimatedStyle]}>
            <Image source={SAPLING} style={styles.treeImg} resizeMode="contain" />
          </Animated.View>
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    borderRadius: radius.lg,
    paddingTop: WRAP_TOP_PADDING,
    paddingBottom: 0,
    overflow: "visible",
  },
  hudRow: {
    position: "absolute",
    top: 0,
    left: 14,
    right: 14,
    zIndex: 5,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  scoreBubble: {
    minWidth: 64,
    height: 64,
    borderRadius: 32,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.76)",
    backgroundColor: "rgba(171, 211, 255, 0.24)",
    shadowColor: "#8EC8FF",
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  scoreValue: {
    color: "#2F70E6",
    fontSize: 26,
    lineHeight: 30,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  pendingHudGroup: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "flex-end",
    maxWidth: 138,
    gap: 8,
  },
  pendingQueueWrap: {
    width: 52,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    alignContent: "flex-start",
    gap: 4,
    paddingTop: 6,
  },
  pendingMiniDrop: {
    width: 14,
    height: 20,
    borderBottomLeftRadius: 10,
    borderBottomRightRadius: 10,
    borderTopLeftRadius: 10,
    borderTopRightRadius: 4,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.78)",
    backgroundColor: "rgba(154,226,255,0.2)",
    overflow: "hidden",
  },
  pendingMiniGradient: {
    ...StyleSheet.absoluteFillObject,
  },
  pendingMiniHighlight: {
    position: "absolute",
    top: 3,
    left: 3,
    width: 5,
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.72)",
  },
  pendingOverflowBadge: {
    minWidth: 24,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 5,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(55, 116, 224, 0.92)",
  },
  pendingOverflowText: {
    color: "#FFFFFF",
    fontSize: 10,
    lineHeight: 12,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  pendingDropWrap: {
    width: PENDING_DROP_SIZE.width,
    height: PENDING_DROP_SIZE.height,
    alignItems: "center",
    justifyContent: "center",
  },
  pendingDrop: {
    width: 30,
    height: 42,
    borderBottomLeftRadius: 22,
    borderBottomRightRadius: 22,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 8,
    backgroundColor: "rgba(144, 217, 255, 0.22)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.85)",
    overflow: "hidden",
    shadowColor: "#9DDCFF",
    shadowOpacity: 0.35,
    shadowRadius: 11,
    shadowOffset: { width: 0, height: 5 },
    elevation: 4,
  },
  pendingDropGradient: {
    ...StyleSheet.absoluteFillObject,
  },
  pendingDropHighlightPrimary: {
    position: "absolute",
    top: 4,
    left: 6,
    width: 12,
    height: 14,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.84)",
  },
  pendingDropHighlightSecondary: {
    position: "absolute",
    top: 9,
    left: 15,
    width: 7,
    height: 8,
    borderRadius: 5,
    backgroundColor: "rgba(255,255,255,0.52)",
  },
  pendingDropRefract: {
    position: "absolute",
    bottom: 8,
    left: 5,
    width: 20,
    height: 12,
    borderRadius: 8,
    backgroundColor: "rgba(186, 236, 255, 0.38)",
  },
  pendingDropCoreGlow: {
    position: "absolute",
    top: 16,
    left: 12,
    width: 10,
    height: 14,
    borderRadius: 8,
    backgroundColor: "rgba(121, 213, 255, 0.24)",
  },
  scene: {
    minHeight: 148,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "center",
    gap: 0,
    paddingHorizontal: 4,
  },
  meerkatWrap: {
    position: "relative",
    width: MEERKAT_SIZE.width,
    height: MEERKAT_SIZE.height,
    justifyContent: "flex-end",
  },
  meerkatImg: {
    width: MEERKAT_SIZE.width,
    height: MEERKAT_SIZE.height,
  },
  faceEyeOverlay: {
    position: "absolute",
    left: 0,
    top: 0,
    width: MEERKAT_SIZE.width,
    height: MEERKAT_SIZE.height,
    zIndex: 2,
  },
  eyeSlot: {
    position: "absolute",
    width: 28,
    height: 22,
    overflow: "visible",
  },
  eyeRightMirror: {
    transform: [{ scaleX: -1 }],
  },
  eyeLayer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  eyeOpenLayer: {
    zIndex: 2,
  },
  eyeClosedLayer: {
    zIndex: 3,
  },
  faceEyeLeft: {
    left: 57,
    top: 31,
  },
  faceEyeRight: {
    left: 92,
    top: 34,
  },
  eyeOpenImage: {
    width: 22,
    height: 22,
  },
  eyeClosedImage: {
    width: 27,
    height: 15,
  },
  treeColumn: {
    width: TREE_SIZE.width + 8,
    marginLeft: -28,
    alignItems: "center",
    justifyContent: "flex-end",
    paddingBottom: 2,
  },
  treeInner: {
    alignItems: "center",
    justifyContent: "flex-end",
  },
  treeImg: {
    width: TREE_SIZE.width,
    height: TREE_SIZE.height,
  },
  flyingDrop: {
    position: "absolute",
    left: 0,
    top: 0,
    width: 10,
    height: 14,
    borderBottomLeftRadius: 9,
    borderBottomRightRadius: 9,
    borderTopLeftRadius: 9,
    borderTopRightRadius: 3,
    backgroundColor: "rgba(139, 220, 255, 0.95)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.8)",
    shadowColor: "#81D6FF",
    shadowOpacity: 0.32,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    zIndex: 4,
  },
});
