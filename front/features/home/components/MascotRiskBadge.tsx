import { memo } from "react";
import { Image, StyleSheet, View } from "react-native";

import { type MascotVisualState } from "./useMascotState";

type MascotRiskBadgeProps = {
  state: MascotVisualState;
};

const BADGE_ASSETS = {
  medium: require("../assets/generated-parts/badge-medium.png"),
  high: require("../assets/generated-parts/badge-high.png"),
} as const;

const BADGE_LAYOUT = {
  medium: { left: 112, top: 4, width: 15, height: 15 },
  high: { left: 112, top: 2, width: 16, height: 16 },
} as const;

export const MascotRiskBadge = memo(function MascotRiskBadge({ state }: MascotRiskBadgeProps) {
  if (state === "low") {
    return null;
  }

  const asset = BADGE_ASSETS[state];
  const layout = BADGE_LAYOUT[state];

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
    zIndex: 5,
  },
  image: {
    width: "100%",
    height: "100%",
  },
});
