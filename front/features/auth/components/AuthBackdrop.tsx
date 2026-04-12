import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { palette, radius } from "@/shared/theme";

const signalRows = Array.from({ length: 6 }, (_, index) => index);

function AuthBackdropComponent() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={styles.glowTop} />
      <View style={styles.glowBottom} />
      <View style={styles.sheetTop} />
      <View style={styles.sheetBottom} />
      <View style={styles.ring} />

      <View style={styles.signalGrid}>
        {signalRows.map((row) => (
          <View key={row} style={[styles.signalRow, { top: row * 18 }]} />
        ))}
      </View>

      <Text style={styles.watermark}>SAFE PASS</Text>
    </View>
  );
}

export const AuthBackdrop = memo(AuthBackdropComponent);

const styles = StyleSheet.create({
  glowTop: {
    position: "absolute",
    top: -110,
    right: -70,
    width: 290,
    height: 290,
    borderRadius: 999,
    backgroundColor: palette.accentSoft,
    opacity: 0.9,
  },
  glowBottom: {
    position: "absolute",
    bottom: -130,
    left: -80,
    width: 280,
    height: 280,
    borderRadius: 999,
    backgroundColor: palette.warmSoft,
    opacity: 0.75,
  },
  ring: {
    position: "absolute",
    bottom: 64,
    right: -18,
    width: 132,
    height: 132,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: palette.lineStrong,
    opacity: 0.26,
  },
  sheetTop: {
    position: "absolute",
    top: 100,
    left: -36,
    width: 160,
    height: 84,
    borderRadius: radius.xl,
    backgroundColor: palette.white,
    borderWidth: 1,
    borderColor: palette.line,
    transform: [{ rotate: "-14deg" }],
    opacity: 0.5,
  },
  sheetBottom: {
    position: "absolute",
    bottom: 168,
    right: 36,
    width: 150,
    height: 72,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: palette.line,
    transform: [{ rotate: "12deg" }],
    opacity: 0.5,
  },
  signalGrid: {
    position: "absolute",
    top: 172,
    right: 34,
    width: 130,
    height: 100,
    overflow: "hidden",
  },
  signalRow: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: palette.lineStrong,
    opacity: 0.2,
  },
  watermark: {
    position: "absolute",
    top: 110,
    right: -48,
    fontSize: 52,
    letterSpacing: 8,
    color: palette.lineStrong,
    opacity: 0.14,
    transform: [{ rotate: "90deg" }],
    fontWeight: "700",
  },
});
