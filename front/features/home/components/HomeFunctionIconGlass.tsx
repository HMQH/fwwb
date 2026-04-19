import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import type { ReactNode } from "react";
import { Platform, StyleSheet, View } from "react-native";

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const h = hex.replace("#", "").trim();
  if (h.length !== 6) {
    return null;
  }
  const n = Number.parseInt(h, 16);
  if (!Number.isFinite(n)) {
    return null;
  }
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function softGradientStops(soft: string): [string, string] {
  const rgb = hexToRgb(soft);
  if (!rgb) {
    return ["rgba(220, 231, 255, 0.4)", "rgba(220, 231, 255, 0.12)"];
  }
  return [`rgba(${rgb.r},${rgb.g},${rgb.b},0.44)`, `rgba(${rgb.r},${rgb.g},${rgb.b},0.12)`];
}

type HomeFunctionIconGlassProps = {
  /** 与 functionCatalog 中 entry.soft 一致，用于着色毛玻璃 */
  soft: string;
  outerSize: number;
  borderRadius: number;
  children: ReactNode;
};

export function HomeFunctionIconGlass({
  soft,
  outerSize,
  borderRadius,
  children,
}: HomeFunctionIconGlassProps) {
  const [tintTop, tintBottom] = softGradientStops(soft);
  const blurIntensity = Platform.OS === "ios" ? 50 : Platform.OS === "android" ? 32 : 28;

  return (
    <View
      style={[
        styles.host,
        {
          width: outerSize,
          height: outerSize,
          borderRadius,
        },
      ]}
    >
      <BlurView intensity={blurIntensity} tint="light" style={StyleSheet.absoluteFill} />
      <LinearGradient
        colors={[tintTop, tintBottom]}
        start={{ x: 0.12, y: 0 }}
        end={{ x: 0.88, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={["rgba(255,255,255,0.45)", "rgba(255,255,255,0.08)", "rgba(255,255,255,0)"]}
        start={{ x: 0.15, y: 0 }}
        end={{ x: 0.75, y: 0.9 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <View style={styles.iconSlot} pointerEvents="none">
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.82)",
    backgroundColor: "rgba(255, 255, 255, 0.22)",
    shadowColor: "#7A9BC4",
    shadowOpacity: 0.18,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  iconSlot: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
});
