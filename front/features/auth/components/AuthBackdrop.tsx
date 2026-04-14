import { memo } from "react";
import { StyleSheet, View } from "react-native";

import { palette, radius } from "@/shared/theme";

function AuthBackdropComponent() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={styles.topCircle} />
      <View style={styles.topPlate} />
      <View style={styles.topSquare} />
      <View style={styles.frame} />
      <View style={styles.bottomCircle} />
      <View style={styles.bottomPlate} />
    </View>
  );
}

export const AuthBackdrop = memo(AuthBackdropComponent);

const styles = StyleSheet.create({
  topCircle: {
    position: "absolute",
    top: -120,
    left: -90,
    width: 260,
    height: 260,
    borderRadius: 999,
    backgroundColor: palette.backgroundMuted,
    opacity: 0.72,
  },
  topPlate: {
    position: "absolute",
    top: 28,
    right: -36,
    width: 220,
    height: 116,
    borderRadius: 40,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    transform: [{ rotate: "-10deg" }],
    opacity: 0.95,
  },
  topSquare: {
    position: "absolute",
    top: 78,
    left: 24,
    width: 76,
    height: 76,
    borderRadius: radius.lg,
    backgroundColor: palette.surfaceStrong,
    opacity: 0.72,
  },
  frame: {
    position: "absolute",
    top: 92,
    right: 28,
    width: 118,
    height: 118,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: "rgba(255,255,255,0.5)",
  },
  bottomCircle: {
    position: "absolute",
    right: -108,
    bottom: -148,
    width: 330,
    height: 330,
    borderRadius: 999,
    backgroundColor: palette.backgroundMuted,
    opacity: 0.48,
  },
  bottomPlate: {
    position: "absolute",
    left: -52,
    bottom: 112,
    width: 238,
    height: 84,
    borderRadius: radius.xl,
    backgroundColor: palette.accentSoft,
    transform: [{ rotate: "-12deg" }],
    opacity: 0.72,
  },
});
