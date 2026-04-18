import { memo, useEffect } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { palette } from "@/shared/theme";
import { useReduceMotionEnabled } from "@/shared/useReduceMotionEnabled";

import { type MascotVisualState } from "./useMascotState";

type MascotAuraProps = {
  state: MascotVisualState;
  style?: StyleProp<ViewStyle>;
};

const AnimatedView = Animated.createAnimatedComponent(View);

function getAuraColors(state: MascotVisualState) {
  if (state === "grounded") {
    return {
      halo: "rgba(255,206,129,0.22)",
      ring: "rgba(84,124,245,0.20)",
      mote: "rgba(255,208,102,0.72)",
    };
  }

  if (state === "sleepy") {
    return {
      halo: "rgba(178,192,224,0.18)",
      ring: "rgba(102,138,220,0.16)",
      mote: "rgba(194,204,229,0.78)",
    };
  }

  if (state === "guarding") {
    return {
      halo: "rgba(122,164,255,0.22)",
      ring: "rgba(86,128,255,0.18)",
      mote: "rgba(255,214,111,0.86)",
    };
  }

  return {
    halo: "rgba(116,160,255,0.28)",
    ring: "rgba(93,130,255,0.20)",
    mote: "rgba(255,209,92,0.92)",
  };
}

function getMotionRange(state: MascotVisualState) {
  if (state === "grounded") {
    return {
      duration: 2600,
      lift: 4,
      pulse: 0.05,
    };
  }

  if (state === "sleepy") {
    return {
      duration: 3000,
      lift: 5,
      pulse: 0.06,
    };
  }

  if (state === "guarding") {
    return {
      duration: 2300,
      lift: 6,
      pulse: 0.08,
    };
  }

  return {
    duration: 2100,
    lift: 7,
    pulse: 0.1,
  };
}

export const MascotAura = memo(function MascotAura({ state, style }: MascotAuraProps) {
  const reduceMotion = useReduceMotionEnabled();
  const drift = useSharedValue(0);
  const pulse = useSharedValue(0);
  const orbit = useSharedValue(0);
  const motion = getMotionRange(state);
  const colors = getAuraColors(state);

  useEffect(() => {
    if (reduceMotion) {
      drift.value = 0;
      pulse.value = 0;
      orbit.value = 0;
      return;
    }

    drift.value = withRepeat(
      withTiming(1, {
        duration: motion.duration,
        easing: Easing.inOut(Easing.ease),
      }),
      -1,
      true
    );

    pulse.value = withRepeat(
      withTiming(1, {
        duration: motion.duration + 280,
        easing: Easing.inOut(Easing.ease),
      }),
      -1,
      true
    );

    orbit.value = withRepeat(
      withTiming(1, {
        duration: motion.duration + 420,
        easing: Easing.linear,
      }),
      -1,
      false
    );
  }, [drift, motion.duration, orbit, pulse, reduceMotion]);

  const haloStyle = useAnimatedStyle(() => ({
    opacity: interpolate(pulse.value, [0, 1], [0.22, 0.42]),
    transform: [
      { translateY: interpolate(drift.value, [0, 1], [0, -motion.lift]) },
      { scale: interpolate(pulse.value, [0, 1], [1, 1 + motion.pulse]) },
    ],
  }));

  const ringStyle = useAnimatedStyle(() => ({
    opacity: interpolate(pulse.value, [0, 1], [0.18, 0.34]),
    transform: [{ scale: interpolate(pulse.value, [0, 1], [0.94, 1.04]) }],
  }));

  const leftMoteStyle = useAnimatedStyle(() => ({
    opacity: interpolate(pulse.value, [0, 1], [0.42, 0.92]),
    transform: [
      { translateX: interpolate(orbit.value, [0, 0.5, 1], [-8, -16, -8]) },
      { translateY: interpolate(orbit.value, [0, 0.5, 1], [8, -10, 8]) },
      { scale: interpolate(pulse.value, [0, 1], [0.84, 1.1]) },
    ],
  }));

  const rightMoteStyle = useAnimatedStyle(() => ({
    opacity: interpolate(pulse.value, [0, 1], [0.32, 0.84]),
    transform: [
      { translateX: interpolate(orbit.value, [0, 0.5, 1], [6, 14, 6]) },
      { translateY: interpolate(orbit.value, [0, 0.5, 1], [-6, 10, -6]) },
      { scale: interpolate(pulse.value, [0, 1], [0.78, 1.02]) },
    ],
  }));

  const bottomGlowStyle = useAnimatedStyle(() => ({
    opacity: interpolate(pulse.value, [0, 1], [0.1, 0.22]),
    transform: [{ scaleX: interpolate(pulse.value, [0, 1], [0.92, 1.06]) }],
  }));

  return (
    <View pointerEvents="none" style={[styles.root, style]}>
      <AnimatedView style={[styles.halo, { backgroundColor: colors.halo }, haloStyle]} />
      <AnimatedView style={[styles.ring, { borderColor: colors.ring }, ringStyle]} />
      <AnimatedView style={[styles.leftMote, { backgroundColor: colors.mote }, leftMoteStyle]} />
      <AnimatedView style={[styles.rightMote, { backgroundColor: colors.mote }, rightMoteStyle]} />
      <AnimatedView style={[styles.bottomGlow, { backgroundColor: palette.accentStrong }, bottomGlowStyle]} />
    </View>
  );
});

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  halo: {
    position: "absolute",
    width: 128,
    height: 128,
    borderRadius: 64,
  },
  ring: {
    position: "absolute",
    width: 152,
    height: 152,
    borderRadius: 76,
    borderWidth: 1,
  },
  leftMote: {
    position: "absolute",
    left: 18,
    top: 50,
    width: 8,
    height: 8,
    borderRadius: 999,
  },
  rightMote: {
    position: "absolute",
    right: 20,
    top: 40,
    width: 6,
    height: 6,
    borderRadius: 999,
  },
  bottomGlow: {
    position: "absolute",
    bottom: 34,
    width: 86,
    height: 22,
    borderRadius: 999,
    opacity: 0.16,
  },
});
