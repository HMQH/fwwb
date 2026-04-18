import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useMemo, useEffect } from "react";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, {
  FadeInDown,
  FadeInUp,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth, type UserRole } from "@/features/auth";
import type { DetectionMode } from "@/features/detections";
import { fontFamily, palette, panelShadow } from "@/shared/theme";

import { HomeMascot } from "@/features/home/components/HomeMascot";
import { useReduceMotionEnabled } from "@/shared/useReduceMotionEnabled";

const detectionEntries: {
  mode: DetectionMode;
  title: string;
  route: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
}[] = [
  {
    mode: "text",
    title: "文本检测",
    route: "/detect-text",
    icon: "message-text-outline",
  },
  {
    mode: "visual",
    title: "图片/视频检测",
    route: "/detect-visual",
    icon: "image-search-outline",
  },
  {
    mode: "audio",
    title: "音频检测",
    route: "/detect-audio",
    icon: "microphone-outline",
  },
  {
    mode: "mixed",
    title: "混合检测",
    route: "/detect-mixed",
    icon: "layers-triple-outline",
  },
];

function getScore(userRole: UserRole, guardianRelation: string | null) {
  const baseScore = {
    office_worker: 95,
    student: 96,
    mother: 95,
    investor: 94,
    minor: 97,
    young_social: 95,
    elder: 93,
    finance: 94,
  }[userRole];

  const relationBonus = guardianRelation && guardianRelation !== "self" ? 2 : 0;

  return Math.min(99, baseScore + relationBonus);
}

function getScorePalette(score: number) {
  if (score >= 97) {
    return {
      shell: "#6FC7FF",
      shellSecondary: "#7A9BFF",
      shellSoft: "rgba(111, 199, 255, 0.26)",
      ring: "#4B99FF",
      ringSecondary: "#8AD9FF",
      ringSoft: "#D8EDFF",
      core: "#F7FBFF",
      text: "#2F70E6",
      label: "#7E9BC1",
      shadow: "#8FC6FF",
    };
  }

  if (score >= 93) {
    return {
      shell: "#88B1FF",
      shellSecondary: "#7B8FFF",
      shellSoft: "rgba(125, 160, 255, 0.24)",
      ring: "#5D82F1",
      ringSecondary: "#98C9FF",
      ringSoft: "#DDE5FF",
      core: "#F8FAFF",
      text: "#416DE0",
      label: "#8594B8",
      shadow: "#B4C7FF",
    };
  }

  if (score >= 85) {
    return {
      shell: "#FFB37C",
      shellSecondary: "#FF7F7B",
      shellSoft: "rgba(255, 155, 125, 0.24)",
      ring: "#FF8366",
      ringSecondary: "#FFD39B",
      ringSoft: "#FFE3D0",
      core: "#FFF9F6",
      text: "#E46A4B",
      label: "#C58B77",
      shadow: "#FFC3AF",
    };
  }

  return {
    shell: "#FF7C8C",
    shellSecondary: "#FF5656",
    shellSoft: "rgba(255, 104, 122, 0.24)",
    ring: "#FF5C5C",
    ringSecondary: "#FFB2A5",
    ringSoft: "#FFD7D9",
    core: "#FFF8F8",
    text: "#E44757",
    label: "#C9878F",
    shadow: "#FFB6BE",
  };
}

function ScoreBubble({ score }: { score: number }) {
  const reduceMotion = useReduceMotionEnabled();
  const floatValue = useSharedValue(0);
  const scaleValue = useSharedValue(1);
  const shimmerValue = useSharedValue(0);

  const tone = useMemo(() => getScorePalette(score), [score]);

  useEffect(() => {
    if (reduceMotion) {
      floatValue.value = 0;
      scaleValue.value = 1;
      shimmerValue.value = 0;
      return;
    }

    floatValue.value = withRepeat(
      withSequence(withTiming(-8, { duration: 2200 }), withTiming(0, { duration: 2200 })),
      -1,
      false
    );

    scaleValue.value = withSequence(withTiming(1.02, { duration: 560 }), withTiming(1, { duration: 640 }));

    shimmerValue.value = withRepeat(
      withSequence(withTiming(1, { duration: 2600 }), withTiming(0, { duration: 2600 })),
      -1,
      false
    );
  }, [floatValue, reduceMotion, scaleValue, shimmerValue]);

  const bubbleStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: floatValue.value }, { scale: scaleValue.value }],
  }));

  const shimmerStyle = useAnimatedStyle(() => ({
    opacity: 0.22 + shimmerValue.value * 0.18,
    transform: [{ translateY: -2 + shimmerValue.value * 6 }, { scale: 0.98 + shimmerValue.value * 0.04 }],
  }));

  return (
    <View style={styles.scoreStage}>
      <View style={[styles.scoreHalo, { backgroundColor: tone.shellSoft }]} />
      <View style={[styles.scoreHaloOuter, { borderColor: tone.shellSoft }]} />

      <Animated.View style={[styles.scoreBubble, bubbleStyle, { shadowColor: tone.shadow }]}>
        <View style={[styles.scoreBubbleShell, { backgroundColor: tone.shell }]} />
        <View style={[styles.scoreBubbleShellSecondary, { backgroundColor: tone.shellSecondary }]} />
        <View style={[styles.scoreBubbleSurface, { borderColor: "rgba(255,255,255,0.34)" }]} />
        <View style={[styles.scoreRingTrack, { borderColor: tone.ringSoft }]} />
        <View
          style={[
            styles.scoreRingFront,
            { borderTopColor: tone.ring, borderRightColor: tone.ringSecondary },
          ]}
        />
        <View
          style={[
            styles.scoreRingBack,
            {
              borderTopColor: "rgba(255,255,255,0.58)",
              borderRightColor: "rgba(255,255,255,0.22)",
            },
          ]}
        />
        <Animated.View style={[styles.bubbleGlossLarge, shimmerStyle]} />
        <View style={styles.bubbleGlossMedium} />
        <View style={styles.bubbleGlossSmall} />
        <View style={styles.bubbleGlossEdge} />
        <View style={styles.bubbleOrbitTop} />
        <View style={styles.bubbleOrbitBottom} />
        <View style={styles.bubbleOrbitSide} />
        <View style={[styles.scoreCore, { backgroundColor: tone.core }]}>
          <Text style={[styles.scoreLabel, { color: tone.label }]}>安全值</Text>
          <Text style={[styles.scoreText, { color: tone.text }]}>{score}</Text>
        </View>
      </Animated.View>
    </View>
  );
}

export default function HomeScreen() {
  const router = useRouter();
  const reduceMotion = useReduceMotionEnabled();
  const { user } = useAuth();

  const score = useMemo(() => {
    if (!user) {
      return 5;
    }

    return getScore(user.role, user.guardian_relation);
  }, [user]);

  if (!user) {
    return null;
  }

  return (
    <View style={styles.root}>
      <View style={styles.backgroundOrbTop} />
      <View style={styles.backgroundOrbBottom} />

      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Animated.View entering={reduceMotion ? undefined : FadeInDown.duration(420)}>
            <HomeMascot score={score} />
          </Animated.View>

          <Animated.View entering={reduceMotion ? undefined : FadeInDown.duration(420).delay(70)}>
            <ScoreBubble score={score} />
          </Animated.View>

          <View style={styles.entryGrid}>
            {detectionEntries.map((item, index) => (
              <Animated.View
                key={item.mode}
                entering={reduceMotion ? undefined : FadeInUp.duration(420).delay(80 + index * 70)}
                style={styles.entryCell}
              >
                <Pressable
                  style={({ pressed }) => [styles.entryCard, pressed && styles.entryCardPressed]}
                  onPress={() => router.push(item.route as never)}
                >
                  <View style={styles.entryIconWrap}>
                    <MaterialCommunityIcons name={item.icon} size={18} color={palette.accentStrong} />
                  </View>
                  <Text style={styles.entryTitle}>{item.title}</Text>
                  <MaterialCommunityIcons name="chevron-right" size={16} color={palette.lineStrong} />
                </Pressable>
              </Animated.View>
            ))}
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: palette.background,
  },
  safeArea: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 28,
    gap: 12,
  },
  backgroundOrbTop: {
    position: "absolute",
    top: -110,
    left: -48,
    width: 260,
    height: 260,
    borderRadius: 999,
    backgroundColor: "rgba(117, 167, 255, 0.12)",
  },
  backgroundOrbBottom: {
    position: "absolute",
    right: -92,
    bottom: 140,
    width: 240,
    height: 240,
    borderRadius: 999,
    backgroundColor: "rgba(196, 218, 255, 0.2)",
  },
  scoreStage: {
    minHeight: 312,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  scoreHalo: {
    position: "absolute",
    width: 274,
    height: 274,
    borderRadius: 999,
    transform: [{ scale: 1.05 }],
  },
  scoreHaloOuter: {
    position: "absolute",
    width: 294,
    height: 294,
    borderRadius: 999,
    borderWidth: 1,
    opacity: 0.46,
  },
  scoreBubble: {
    width: 236,
    height: 236,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    shadowOpacity: 0.24,
    shadowRadius: 28,
    shadowOffset: {
      width: 0,
      height: 16,
    },
    elevation: 16,
  },
  scoreBubbleShell: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 999,
  },
  scoreBubbleShellSecondary: {
    position: "absolute",
    top: 14,
    right: 14,
    bottom: 14,
    left: 14,
    borderRadius: 999,
    opacity: 0.24,
  },
  scoreBubbleSurface: {
    position: "absolute",
    top: 9,
    right: 9,
    bottom: 9,
    left: 9,
    borderRadius: 999,
    borderWidth: 1,
    opacity: 0.72,
  },
  scoreRingTrack: {
    position: "absolute",
    width: 212,
    height: 212,
    borderRadius: 999,
    borderWidth: 14,
  },
  scoreRingFront: {
    position: "absolute",
    width: 212,
    height: 212,
    borderRadius: 999,
    borderWidth: 14,
    borderColor: "transparent",
    transform: [{ rotate: "-26deg" }],
  },
  scoreRingBack: {
    position: "absolute",
    width: 184,
    height: 184,
    borderRadius: 999,
    borderWidth: 10,
    borderColor: "transparent",
    transform: [{ rotate: "36deg" }],
  },
  bubbleGlossLarge: {
    position: "absolute",
    top: 32,
    left: 42,
    width: 112,
    height: 86,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.22)",
    transform: [{ rotate: "-18deg" }],
  },
  bubbleGlossMedium: {
    position: "absolute",
    top: 60,
    right: 48,
    width: 46,
    height: 28,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.22)",
    transform: [{ rotate: "24deg" }],
  },
  bubbleGlossSmall: {
    position: "absolute",
    top: 78,
    right: 56,
    width: 26,
    height: 26,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.32)",
  },
  bubbleGlossEdge: {
    position: "absolute",
    bottom: 28,
    right: 44,
    width: 70,
    height: 22,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.12)",
    transform: [{ rotate: "-14deg" }],
  },
  bubbleOrbitTop: {
    position: "absolute",
    top: 26,
    right: 38,
    width: 16,
    height: 16,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.34)",
  },
  bubbleOrbitBottom: {
    position: "absolute",
    bottom: 42,
    left: 28,
    width: 20,
    height: 20,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.16)",
  },
  bubbleOrbitSide: {
    position: "absolute",
    top: 122,
    left: 18,
    width: 14,
    height: 14,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  scoreCore: {
    width: 132,
    height: 132,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.78)",
    gap: 2,
  },
  scoreLabel: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  scoreText: {
    fontSize: 56,
    lineHeight: 60,
    fontWeight: "900",
    fontFamily: fontFamily.display,
    letterSpacing: 1.2,
  },
  entryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  entryCell: {
    width: "48%",
  },
  entryCard: {
    minHeight: 102,
    borderRadius: 24,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 14,
    paddingVertical: 14,
    justifyContent: "space-between",
    ...panelShadow,
  },
  entryCardPressed: {
    opacity: 0.92,
    transform: [{ scale: 0.99 }],
  },
  entryIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 13,
    backgroundColor: palette.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  entryTitle: {
    color: palette.ink,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
});
