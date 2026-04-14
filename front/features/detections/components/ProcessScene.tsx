import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

import { radius } from "@/shared/theme";
import { useReduceMotionEnabled } from "@/shared/useReduceMotionEnabled";

import type { KnownDetectionPipelineStep } from "../types";
import { pipelineStepMeta } from "../visualization";

type Point = { x: number; y: number };

type LoopProps = {
  progress: SharedValue<number>;
  reduceMotion: boolean;
};

function MovingChip({
  progress,
  from,
  to,
  delay,
  color,
}: LoopProps & { from: Point; to: Point; delay: number; color: string }) {
  const animatedStyle = useAnimatedStyle(() => {
    const raw = (progress.value + delay) % 1;
    const x = interpolate(raw, [0, 1], [from.x, to.x]);
    const y = interpolate(raw, [0, 1], [from.y, to.y]);
    const opacity = 0.28 + (1 - Math.abs(raw - 0.5) * 2) * 0.72;
    return {
      opacity,
      transform: [{ translateX: x }, { translateY: y }, { scale: 0.84 + opacity * 0.16 }],
    };
  });

  return <Animated.View style={[styles.movingChip, { backgroundColor: color }, animatedStyle]} />;
}

function FlowPulse({
  progress,
  from,
  to,
  delay,
  color,
}: LoopProps & { from: Point; to: Point; delay: number; color: string }) {
  const animatedStyle = useAnimatedStyle(() => {
    const raw = (progress.value + delay) % 1;
    const x = interpolate(raw, [0, 1], [from.x, to.x]);
    const y = interpolate(raw, [0, 1], [from.y, to.y]);
    return {
      opacity: 0.2 + (1 - Math.abs(raw - 0.5) * 2) * 0.8,
      transform: [{ translateX: x }, { translateY: y }, { scale: 0.9 + raw * 0.2 }],
    };
  });

  return <Animated.View style={[styles.flowPulse, { backgroundColor: color }, animatedStyle]} />;
}

function QueuedScene({ progress, reduceMotion }: LoopProps) {
  const dotStyle = (index: number) =>
    useAnimatedStyle(() => {
      const raw = reduceMotion ? index * 0.16 : (progress.value + index * 0.22) % 1;
      const opacity = 0.28 + (1 - Math.abs(raw - 0.5) * 2) * 0.72;
      return {
        opacity,
        transform: [{ translateY: -4 + opacity * 6 }, { scale: 0.84 + opacity * 0.2 }],
      };
    });

  const styleA = dotStyle(0);
  const styleB = dotStyle(1);
  const styleC = dotStyle(2);

  return (
    <View style={styles.sceneFrame}>
      <View style={styles.queueRail} />
      <Animated.View style={[styles.queueDot, styleA]} />
      <Animated.View style={[styles.queueDot, styleB]} />
      <Animated.View style={[styles.queueDot, styleC]} />
    </View>
  );
}

function EmbeddingScene({ progress, reduceMotion }: LoopProps) {
  return (
    <View style={styles.sceneFrame}>
      <View style={styles.embeddingRack}>
        <View style={styles.embeddingBar} />
        <View style={[styles.embeddingBar, styles.embeddingBarShort]} />
        <View style={styles.embeddingBar} />
        <View style={[styles.embeddingBar, styles.embeddingBarTiny]} />
      </View>
      {!reduceMotion ? (
        <>
          <MovingChip progress={progress} reduceMotion={reduceMotion} from={{ x: 18, y: 34 }} to={{ x: 132, y: 28 }} delay={0} color="#6AB6FF" />
          <MovingChip progress={progress} reduceMotion={reduceMotion} from={{ x: 24, y: 76 }} to={{ x: 138, y: 58 }} delay={0.22} color="#A7C8FF" />
          <MovingChip progress={progress} reduceMotion={reduceMotion} from={{ x: 14, y: 118 }} to={{ x: 130, y: 92 }} delay={0.44} color="#7E9AF8" />
        </>
      ) : (
        <>
          <View style={[styles.staticChip, { left: 28, top: 34, backgroundColor: "#6AB6FF" }]} />
          <View style={[styles.staticChip, { left: 42, top: 78, backgroundColor: "#A7C8FF" }]} />
          <View style={[styles.staticChip, { left: 18, top: 118, backgroundColor: "#7E9AF8" }]} />
        </>
      )}
      <View style={[styles.sceneNode, { right: 24, top: 48, backgroundColor: "#FFFFFF", borderColor: "#D7E8FF" }]}>
        <MaterialCommunityIcons name="blur-linear" size={20} color="#2F70E6" />
      </View>
    </View>
  );
}

function RetrievalScene({ progress, reduceMotion }: LoopProps) {
  return (
    <View style={styles.sceneFrame}>
      <View style={[styles.sceneNode, styles.centerNode, { backgroundColor: "#FFFFFF", borderColor: "#DBE6FF" }]}>
        <MaterialCommunityIcons name="vector-link" size={18} color="#6A78F5" />
      </View>
      <View style={[styles.clusterCard, { top: 20, right: 20, backgroundColor: "#FFF2EA" }]} />
      <View style={[styles.clusterCard, { bottom: 18, right: 22, backgroundColor: "#EAF5FF" }]} />
      <View style={[styles.sceneLine, { left: 80, top: 70, width: 86, transform: [{ rotateZ: "-18deg" }] }]} />
      <View style={[styles.sceneLine, { left: 82, top: 92, width: 82, transform: [{ rotateZ: "18deg" }] }]} />
      {!reduceMotion ? (
        <>
          <FlowPulse progress={progress} reduceMotion={reduceMotion} from={{ x: 88, y: 82 }} to={{ x: 162, y: 56 }} delay={0.12} color="#E38A57" />
          <FlowPulse progress={progress} reduceMotion={reduceMotion} from={{ x: 90, y: 88 }} to={{ x: 162, y: 116 }} delay={0.58} color="#4B8DF8" />
        </>
      ) : null}
    </View>
  );
}

function GraphScene({ progress, reduceMotion }: LoopProps) {
  const nodes = [
    { left: 20, top: 54, tone: "#4B8DF8" },
    { left: 84, top: 18, tone: "#E38A57" },
    { left: 86, top: 96, tone: "#2E9D7F" },
    { left: 152, top: 58, tone: "#7E67F4" },
  ];
  return (
    <View style={styles.sceneFrame}>
      <View style={[styles.sceneLine, { left: 38, top: 68, width: 76, transform: [{ rotateZ: "-26deg" }] }]} />
      <View style={[styles.sceneLine, { left: 42, top: 80, width: 78, transform: [{ rotateZ: "22deg" }] }]} />
      <View style={[styles.sceneLine, { left: 102, top: 62, width: 74 }]} />
      {nodes.map((node, index) => (
        <View key={`${node.left}-${node.top}-${index}`} style={[styles.graphDot, { left: node.left, top: node.top, backgroundColor: node.tone }]} />
      ))}
      {!reduceMotion ? (
        <>
          <FlowPulse progress={progress} reduceMotion={reduceMotion} from={{ x: 32, y: 66 }} to={{ x: 94, y: 30 }} delay={0.08} color="#E38A57" />
          <FlowPulse progress={progress} reduceMotion={reduceMotion} from={{ x: 36, y: 78 }} to={{ x: 98, y: 110 }} delay={0.42} color="#2E9D7F" />
          <FlowPulse progress={progress} reduceMotion={reduceMotion} from={{ x: 100, y: 64 }} to={{ x: 164, y: 64 }} delay={0.72} color="#7E67F4" />
        </>
      ) : null}
    </View>
  );
}

function LlmScene({ progress, reduceMotion }: LoopProps) {
  const scanStyle = useAnimatedStyle(() => ({
    opacity: reduceMotion ? 0.45 : 0.4 + progress.value * 0.3,
    transform: [{ translateY: reduceMotion ? 18 : progress.value * 96 }],
  }));

  return (
    <View style={styles.sceneFrame}>
      <View style={[styles.stackCard, { left: 30, top: 24 }]} />
      <View style={[styles.stackCard, { left: 44, top: 46, opacity: 0.86 }]} />
      <View style={[styles.stackCard, { left: 58, top: 68, opacity: 0.72 }]} />
      <Animated.View style={[styles.scanBar, scanStyle]} />
      <View style={[styles.sceneNode, { right: 24, top: 48, backgroundColor: "#F3EEFF", borderColor: "#E0D9FF" }]}>
        <MaterialCommunityIcons name="brain" size={20} color="#7E67F4" />
      </View>
    </View>
  );
}

function FinalizeScene({ progress, reduceMotion }: LoopProps) {
  const ringStyle = useAnimatedStyle(() => ({
    opacity: reduceMotion ? 0.5 : 0.22 + progress.value * 0.32,
    transform: [{ scale: reduceMotion ? 1 : 0.92 + progress.value * 0.18 }],
  }));

  return (
    <View style={styles.sceneFrame}>
      <Animated.View style={[styles.finalRing, ringStyle]} />
      <Animated.View style={[styles.finalRing, styles.finalRingOuter, ringStyle]} />
      <View style={[styles.sceneNode, styles.finalNode, { backgroundColor: "#EFFCF7", borderColor: "#D4F2E6" }]}>
        <MaterialCommunityIcons name="shield-check-outline" size={28} color="#2E9D7F" />
      </View>
      {!reduceMotion ? (
        <>
          <FlowPulse progress={progress} reduceMotion={reduceMotion} from={{ x: 84, y: 76 }} to={{ x: 138, y: 46 }} delay={0.18} color="#2E9D7F" />
          <FlowPulse progress={progress} reduceMotion={reduceMotion} from={{ x: 84, y: 76 }} to={{ x: 150, y: 104 }} delay={0.56} color="#6AB6FF" />
        </>
      ) : null}
    </View>
  );
}

export function ProcessScene({ step }: { step: KnownDetectionPipelineStep }) {
  const reduceMotion = useReduceMotionEnabled();
  const progress = useSharedValue(0);
  const meta = pipelineStepMeta[step];

  useEffect(() => {
    if (reduceMotion) {
      progress.value = 0.35;
      return;
    }
    progress.value = withRepeat(
      withTiming(1, { duration: 1800, easing: Easing.linear }),
      -1,
      false,
    );
  }, [progress, reduceMotion]);

  return (
    <View style={[styles.shell, { backgroundColor: meta.soft }]}> 
      {step === "queued" ? <QueuedScene progress={progress} reduceMotion={reduceMotion} /> : null}
      {step === "preprocess" || step === "embedding" ? <EmbeddingScene progress={progress} reduceMotion={reduceMotion} /> : null}
      {step === "vector_retrieval" ? <RetrievalScene progress={progress} reduceMotion={reduceMotion} /> : null}
      {step === "graph_reasoning" ? <GraphScene progress={progress} reduceMotion={reduceMotion} /> : null}
      {step === "llm_reasoning" ? <LlmScene progress={progress} reduceMotion={reduceMotion} /> : null}
      {step === "finalize" ? <FinalizeScene progress={progress} reduceMotion={reduceMotion} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    height: 170,
    borderRadius: radius.lg,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(36, 90, 160, 0.08)",
    padding: 12,
  },
  sceneFrame: {
    flex: 1,
    borderRadius: radius.md,
    backgroundColor: "rgba(255,255,255,0.72)",
    overflow: "hidden",
  },
  movingChip: {
    position: "absolute",
    width: 30,
    height: 10,
    borderRadius: 999,
  },
  staticChip: {
    position: "absolute",
    width: 30,
    height: 10,
    borderRadius: 999,
  },
  flowPulse: {
    position: "absolute",
    width: 10,
    height: 10,
    borderRadius: 999,
  },
  queueRail: {
    position: "absolute",
    left: 28,
    right: 28,
    top: 76,
    height: 6,
    borderRadius: 999,
    backgroundColor: "rgba(47, 112, 230, 0.14)",
  },
  queueDot: {
    position: "absolute",
    top: 68,
    width: 22,
    height: 22,
    borderRadius: 999,
    backgroundColor: "#4B8DF8",
  },
  embeddingRack: {
    position: "absolute",
    right: 20,
    top: 28,
    bottom: 28,
    width: 54,
    borderRadius: radius.md,
    backgroundColor: "rgba(255,255,255,0.78)",
    paddingVertical: 16,
    paddingHorizontal: 10,
    gap: 10,
    justifyContent: "center",
  },
  embeddingBar: {
    height: 8,
    borderRadius: 999,
    backgroundColor: "#8CB8FF",
  },
  embeddingBarShort: {
    width: 22,
  },
  embeddingBarTiny: {
    width: 14,
  },
  sceneNode: {
    position: "absolute",
    width: 46,
    height: 46,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  centerNode: {
    left: 52,
    top: 62,
  },
  clusterCard: {
    position: "absolute",
    width: 42,
    height: 34,
    borderRadius: 16,
  },
  sceneLine: {
    position: "absolute",
    height: 2,
    borderRadius: 999,
    backgroundColor: "rgba(58, 104, 181, 0.22)",
  },
  graphDot: {
    position: "absolute",
    width: 18,
    height: 18,
    borderRadius: 999,
  },
  stackCard: {
    position: "absolute",
    width: 92,
    height: 58,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.82)",
    borderWidth: 1,
    borderColor: "rgba(126, 103, 244, 0.16)",
  },
  scanBar: {
    position: "absolute",
    left: 36,
    width: 128,
    height: 14,
    borderRadius: 999,
    backgroundColor: "rgba(126, 103, 244, 0.14)",
  },
  finalRing: {
    position: "absolute",
    left: "50%",
    top: "50%",
    width: 84,
    height: 84,
    borderRadius: 999,
    marginLeft: -42,
    marginTop: -42,
    borderWidth: 2,
    borderColor: "rgba(46, 157, 127, 0.26)",
  },
  finalRingOuter: {
    width: 118,
    height: 118,
    marginLeft: -59,
    marginTop: -59,
    borderColor: "rgba(106, 182, 255, 0.22)",
  },
  finalNode: {
    left: "50%",
    top: "50%",
    width: 64,
    height: 64,
    marginLeft: -32,
    marginTop: -32,
    borderRadius: 24,
  },
});
