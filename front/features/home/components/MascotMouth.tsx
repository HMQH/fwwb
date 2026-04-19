import { memo } from "react";
import { Image, StyleSheet, View } from "react-native";

import { type MascotVisualState } from "./useMascotState";

type MascotMouthProps = {
  state: MascotVisualState;
};

const MOUTH_ASSETS = {
  medium: require("../assets/generated-parts/mouth-medium.png"),
  high: require("../assets/generated-parts/mouth-high.png"),
} as const;

const MOUTH_LAYOUT = {
  medium: { left: 50, top: 36, width: 36, height: 17 },
  high: { left: 46, top: 35, width: 42, height: 18 },
} as const;

export const MascotMouth = memo(function MascotMouth({ state }: MascotMouthProps) {
  if (state === "low") {
    return null;
  }

  const asset = MOUTH_ASSETS[state];
  const layout = MOUTH_LAYOUT[state];

  return (
    <View
      pointerEvents="none"
      style={[
        styles.root,
        {
          left: layout.left,
          top: layout.top,
          width: layout.width,
          height: layout.height,
        },
      ]}
    >
      <Image source={asset} style={styles.image} resizeMode="contain" />
    </View>
  );
});

const styles = StyleSheet.create({
  root: {
    position: "absolute",
    zIndex: 4,
  },
  image: {
    width: "100%",
    height: "100%",
  },
});
