import { memo } from "react";
import { Image, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated from "react-native-reanimated";

import { type MascotVisualState } from "./useMascotState";

type MascotEyesProps = {
  state: MascotVisualState;
  openStyle?: StyleProp<ViewStyle>;
  closedStyle?: StyleProp<ViewStyle>;
};

const EYE_ASSETS = {
  low: {
    open: require("../../../assets/images/meerkat/eye-open.png"),
    closed: require("../../../assets/images/meerkat/eye-closed.png"),
  },
  medium: {
    open: require("../../../assets/images/meerkat/eye-open.png"),
    closed: require("../../../assets/images/meerkat/eye-closed.png"),
  },
  high: {
    open: require("../../../assets/images/meerkat/eye-open.png"),
    closed: require("../../../assets/images/meerkat/eye-closed.png"),
  },
} as const;

const EYE_LAYOUTS = {
  low: {
    open: { left: 33, top: 12, width: 92, height: 51 },
    closed: { left: 35, top: 12, width: 88, height: 39 },
  },
  medium: {
    open: { left: 33, top: 11, width: 90, height: 50 },
    closed: { left: 35, top: 11, width: 86, height: 38 },
  },
  high: {
    open: { left: 32, top: 10, width: 92, height: 50 },
    closed: { left: 34, top: 10, width: 88, height: 39 },
  },
} as const;

const AnimatedView = Animated.createAnimatedComponent(View);

export const MascotEyes = memo(function MascotEyes({
  state,
  openStyle,
  closedStyle,
}: MascotEyesProps) {
  const assets = EYE_ASSETS[state];
  const layout = EYE_LAYOUTS[state];

  return (
    <>
      <AnimatedView
        style={[
          styles.eyeWrap,
          {
            left: layout.open.left,
            top: layout.open.top,
            width: layout.open.width,
            height: layout.open.height,
          },
          openStyle,
        ]}
      >
        <Image source={assets.open} style={styles.partImage} resizeMode="contain" />
      </AnimatedView>

      <AnimatedView
        style={[
          styles.eyeWrap,
          {
            left: layout.closed.left,
            top: layout.closed.top,
            width: layout.closed.width,
            height: layout.closed.height,
          },
          closedStyle,
        ]}
      >
        <Image source={assets.closed} style={styles.partImage} resizeMode="contain" />
      </AnimatedView>
    </>
  );
});

const styles = StyleSheet.create({
  eyeWrap: {
    position: "absolute",
    zIndex: 2,
  },
  partImage: {
    width: "100%",
    height: "100%",
  },
});
