import * as Haptics from "expo-haptics";
import { memo, useEffect, useMemo } from "react";
import {
  Image,
  Pressable,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { radius } from "@/shared/theme";
import { useReduceMotionEnabled } from "@/shared/useReduceMotionEnabled";

import { MascotAura } from "./MascotAura";
import { MascotEyes } from "./MascotEyes";
import { MascotMouth } from "./MascotMouth";
import { MascotRiskBadge } from "./MascotRiskBadge";
import { useMascotState, type MascotVisualState } from "./useMascotState";

type HomeMascotProps = {
  score: number;
  style?: StyleProp<ViewStyle>;
};

const HEAD_IMAGE = require("../../../assets/images/meerkat/head.png");
const BODY_IMAGE = require("../../../assets/images/meerkat/body.png");
const ARM_LEFT_IMAGE = require("../../../assets/images/meerkat/arm-left.png");
const ARM_RIGHT_IMAGE = require("../../../assets/images/meerkat/arm-right.png");
const TAIL_IMAGE = require("../../../assets/images/meerkat/tail.png");

const STAGE_LAYOUT = {
  width: 214,
  height: 176,
  figureWidth: 210,
  figureHeight: 164,
};

const FIGURE_OFFSET = {
  x: -10,
  y: -20,
};

const PART_LAYOUT = {
  tail: { left: 130, top: 120, width: 63, height: 30, rotate: 2 },
  body: { left: 67, top: 65, width: 110, height: 120 },
  head: { left: 38, top: 18, width: 155, height: 81 },
  leftArm: { left: 72, top: 90, width: 41, height: 39, rotate: -10 },
  rightArm: { left: 122, top: 90, width: 40, height: 40, rotate: 10 },
};

const AnimatedView = Animated.createAnimatedComponent(View);

function getPose(state: MascotVisualState) {
  if (state === "high") {
    return {
      floatLift: 2.5,
      bodyScale: 0.992,
      bodyTilt: -2,
      armLift: 2,
      tailSwing: 4.5,
    };
  }

  if (state === "medium") {
    return {
      floatLift: 3.8,
      bodyScale: 0.998,
      bodyTilt: -1,
      armLift: 1,
      tailSwing: 6.5,
    };
  }

  return {
    floatLift: 5.2,
    bodyScale: 1.01,
    bodyTilt: 0,
    armLift: -1,
    tailSwing: 8.8,
  };
}

export const HomeMascot = memo(function HomeMascot({ score, style }: HomeMascotProps) {
  const reduceMotion = useReduceMotionEnabled();
  const mascotState = useMascotState(score);
  const pose = useMemo(() => getPose(mascotState), [mascotState]);

  const float = useSharedValue(0);
  const breathe = useSharedValue(0);
  const tailLoop = useSharedValue(0);
  const blink = useSharedValue(0);
  const nodLoop = useSharedValue(0);
  const squatLoop = useSharedValue(0);
  const avoidX = useSharedValue(0);
  const avoidY = useSharedValue(0);
  const armKick = useSharedValue(0);
  const bodyBounce = useSharedValue(0);
  const tailKick = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) {
      float.value = 0;
      breathe.value = 0;
      tailLoop.value = 0;
      nodLoop.value = 0;
      squatLoop.value = 0;
    } else {
      float.value = withRepeat(
        withTiming(1, {
          duration: mascotState === "high" ? 1950 : mascotState === "medium" ? 2250 : 2650,
          easing: Easing.inOut(Easing.ease),
        }),
        -1,
        true
      );

      breathe.value = withRepeat(
        withTiming(1, {
          duration: mascotState === "high" ? 2050 : mascotState === "medium" ? 2320 : 2480,
          easing: Easing.inOut(Easing.ease),
        }),
        -1,
        true
      );

      tailLoop.value = withRepeat(
        withTiming(1, {
          duration: mascotState === "high" ? 1680 : mascotState === "medium" ? 1920 : 2140,
          easing: Easing.inOut(Easing.ease),
        }),
        -1,
        true
      );

      nodLoop.value = withRepeat(
        withSequence(
          withDelay(
            mascotState === "high" ? 880 : mascotState === "medium" ? 1450 : 2300,
            withTiming(1, {
              duration: mascotState === "high" ? 180 : mascotState === "medium" ? 200 : 170,
              easing: Easing.out(Easing.quad),
            })
          ),
          withTiming(0, {
            duration: mascotState === "high" ? 230 : mascotState === "medium" ? 250 : 210,
            easing: Easing.out(Easing.quad),
          })
        ),
        -1,
        false
      );

      squatLoop.value = withRepeat(
        withSequence(
          withDelay(
            mascotState === "high" ? 1180 : mascotState === "medium" ? 1720 : 2540,
            withTiming(1, {
              duration: mascotState === "high" ? 260 : mascotState === "medium" ? 230 : 200,
              easing: Easing.out(Easing.quad),
            })
          ),
          withTiming(0, {
            duration: mascotState === "high" ? 320 : mascotState === "medium" ? 290 : 250,
            easing: Easing.out(Easing.quad),
          })
        ),
        -1,
        false
      );
    }

    blink.value = withRepeat(
      withSequence(
        withDelay(2200, withTiming(1, { duration: 90, easing: Easing.out(Easing.quad) })),
        withTiming(0, { duration: 120, easing: Easing.out(Easing.quad) }),
        withDelay(3000, withTiming(1, { duration: 80, easing: Easing.out(Easing.quad) })),
        withTiming(0, { duration: 110, easing: Easing.out(Easing.quad) })
      ),
      -1,
      false
    );
  }, [blink, breathe, float, mascotState, nodLoop, reduceMotion, squatLoop, tailLoop]);

  const squatAmount = mascotState === "high" ? 0.94 : mascotState === "medium" ? 0.46 : 0.18;

  const nodAmount = mascotState === "high" ? 0.72 : mascotState === "medium" ? 0.48 : 0.26;

  const mascotStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: FIGURE_OFFSET.x + avoidX.value * 0.45 },
      {
        translateY:
          FIGURE_OFFSET.y +
          avoidY.value * 0.65 +
          interpolate(float.value, [0, 1], [0, -pose.floatLift]) +
          interpolate(bodyBounce.value, [0, 1], [0, -7]) +
          interpolate(squatLoop.value, [0, 1], [0, 6 * squatAmount]),
      },
      { scale: interpolate(breathe.value, [0, 1], [pose.bodyScale, pose.bodyScale + 0.016]) },
      { rotate: `${pose.bodyTilt + interpolate(avoidX.value, [-18, 0, 18], [2.5, 0, -2.5])}deg` },
    ],
  }));

  const bodyStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY:
          interpolate(bodyBounce.value, [0, 1], [0, -3]) +
          interpolate(squatLoop.value, [0, 1], [0, 2.5 * squatAmount]),
      },
      {
        scaleX:
          interpolate(bodyBounce.value, [0, 1], [1, 1.03]) +
          interpolate(squatLoop.value, [0, 1], [0, 0.028 * squatAmount]),
      },
      {
        scaleY:
          interpolate(breathe.value + bodyBounce.value, [0, 1, 2], [0.994, 1.008, 0.976]) -
          interpolate(squatLoop.value, [0, 1], [0, 0.075 * squatAmount]),
      },
    ],
  }));

  const headStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(avoidX.value, [-18, 18], [-3, 3]) },
      {
        translateY:
          interpolate(float.value, [0, 1], [0, -1.5]) +
          interpolate(bodyBounce.value, [0, 1], [0, -4]) +
          interpolate(nodLoop.value, [0, 1], [0, 4 * nodAmount]) +
          interpolate(squatLoop.value, [0, 1], [0, 2.5 * squatAmount]),
      },
      { rotate: `${interpolate(avoidX.value, [-18, 18], [-3.5, 3.5]) + interpolate(nodLoop.value, [0, 1], [0, 7 * nodAmount])}deg` },
      { scale: interpolate(breathe.value, [0, 1], [0.996, 1.01]) },
    ],
  }));

  const leftArmStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY:
          interpolate(armKick.value, [0, 1], [0, -5 - pose.armLift]) +
          interpolate(squatLoop.value, [0, 1], [0, -1.5 * squatAmount]),
      },
      { rotate: `${PART_LAYOUT.leftArm.rotate - interpolate(armKick.value, [0, 1], [0, 8])}deg` },
    ],
  }));

  const rightArmStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY:
          interpolate(armKick.value, [0, 1], [0, -5 - pose.armLift]) +
          interpolate(squatLoop.value, [0, 1], [0, -1.5 * squatAmount]),
      },
      { rotate: `${PART_LAYOUT.rightArm.rotate + interpolate(armKick.value, [0, 1], [0, 8])}deg` },
    ],
  }));

  const tailStyle = useAnimatedStyle(() => ({
    transform: [
      {
        rotate: `${PART_LAYOUT.tail.rotate + interpolate(tailLoop.value, [0, 1], [-pose.tailSwing, pose.tailSwing]) + interpolate(tailKick.value, [0, 1], [0, 6])}deg`,
      },
      {
        translateY:
          interpolate(tailLoop.value, [0, 1], [0, -1.5]) +
          interpolate(squatLoop.value, [0, 1], [0, 1.5 * squatAmount]),
      },
    ],
  }));

  const openEyesStyle = useAnimatedStyle(() => ({
    opacity: interpolate(blink.value, [0, 0.55, 1], [1, 0.26, 0]),
    transform: [
      { translateY: interpolate(blink.value, [0, 1], [0, 6]) },
      { scaleY: interpolate(blink.value, [0, 0.55, 1], [1, 0.34, 0.18]) },
    ],
  }));

  const closedEyesStyle = useAnimatedStyle(() => ({
    opacity: interpolate(blink.value, [0, 0.4, 0.7, 1], [0, 0.14, 0.72, 1]),
    transform: [
      { translateY: interpolate(blink.value, [0, 1], [6, 0]) },
      { scaleY: interpolate(blink.value, [0, 1], [0.45, 1]) },
    ],
  }));

  const handlePressIn = (event: GestureResponderEvent) => {
    const moveX = event.nativeEvent.locationX < STAGE_LAYOUT.width / 2 ? 16 : -16;
    const moveY = event.nativeEvent.locationY > STAGE_LAYOUT.height / 2 ? -10 : 8;

    avoidX.value = withSequence(
      withTiming(moveX, { duration: 150, easing: Easing.out(Easing.quad) }),
      withSpring(0, { damping: 11, stiffness: 150 })
    );
    avoidY.value = withSequence(
      withTiming(moveY, { duration: 150, easing: Easing.out(Easing.quad) }),
      withSpring(0, { damping: 11, stiffness: 170 })
    );
    armKick.value = withSequence(
      withTiming(1, { duration: 180, easing: Easing.out(Easing.quad) }),
      withTiming(0, { duration: 260, easing: Easing.out(Easing.quad) })
    );
    tailKick.value = withSequence(
      withTiming(1, { duration: 180, easing: Easing.out(Easing.quad) }),
      withTiming(0, { duration: 300, easing: Easing.out(Easing.quad) })
    );
    bodyBounce.value = withSequence(
      withTiming(1, { duration: 120, easing: Easing.out(Easing.quad) }),
      withTiming(0, { duration: 220, easing: Easing.out(Easing.quad) })
    );

    void Haptics.selectionAsync();
  };

  return (
    <View style={[styles.shell, style]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={"点击\u72d0\u7374互动"}
        onPressIn={handlePressIn}
        style={({ pressed }) => [styles.stagePressable, pressed && styles.stagePressablePressed]}
      >
        <View style={styles.stage}>
          <MascotAura state={mascotState} />

          <AnimatedView style={[styles.figureWrap, mascotStyle]}>
            <AnimatedView
              style={[
                styles.tailWrap,
                {
                  left: PART_LAYOUT.tail.left,
                  top: PART_LAYOUT.tail.top,
                  width: PART_LAYOUT.tail.width,
                  height: PART_LAYOUT.tail.height,
                },
                tailStyle,
              ]}
            >
              <Image source={TAIL_IMAGE} style={styles.partImage} resizeMode="contain" />
            </AnimatedView>

            <AnimatedView
              style={[
                styles.bodyWrap,
                {
                  left: PART_LAYOUT.body.left,
                  top: PART_LAYOUT.body.top,
                  width: PART_LAYOUT.body.width,
                  height: PART_LAYOUT.body.height,
                },
                bodyStyle,
              ]}
            >
              <Image source={BODY_IMAGE} style={styles.partImage} resizeMode="contain" />
            </AnimatedView>

            <AnimatedView
              style={[
                styles.leftArmWrap,
                {
                  left: PART_LAYOUT.leftArm.left,
                  top: PART_LAYOUT.leftArm.top,
                  width: PART_LAYOUT.leftArm.width,
                  height: PART_LAYOUT.leftArm.height,
                },
                leftArmStyle,
              ]}
            >
              <Image source={ARM_LEFT_IMAGE} style={styles.partImage} resizeMode="contain" />
            </AnimatedView>

            <AnimatedView
              style={[
                styles.rightArmWrap,
                {
                  left: PART_LAYOUT.rightArm.left,
                  top: PART_LAYOUT.rightArm.top,
                  width: PART_LAYOUT.rightArm.width,
                  height: PART_LAYOUT.rightArm.height,
                },
                rightArmStyle,
              ]}
            >
              <Image source={ARM_RIGHT_IMAGE} style={styles.partImage} resizeMode="contain" />
            </AnimatedView>

            <AnimatedView
              style={[
                styles.headWrap,
                {
                  left: PART_LAYOUT.head.left,
                  top: PART_LAYOUT.head.top,
                  width: PART_LAYOUT.head.width,
                  height: PART_LAYOUT.head.height,
                },
                headStyle,
              ]}
            >
              <Image source={HEAD_IMAGE} style={styles.partImage} resizeMode="contain" />
              <MascotEyes
                state={mascotState}
                openStyle={openEyesStyle}
                closedStyle={closedEyesStyle}
              />
              <MascotMouth state={mascotState} />
              <MascotRiskBadge state={mascotState} />
            </AnimatedView>
          </AnimatedView>
        </View>
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  shell: {
    width: "100%",
    alignItems: "center",
  },
  stagePressable: {
    alignSelf: "center",
    borderRadius: radius.xl,
  },
  stagePressablePressed: {
    transform: [{ scale: 0.988 }],
  },
  stage: {
    width: STAGE_LAYOUT.width,
    height: STAGE_LAYOUT.height,
    alignItems: "center",
    justifyContent: "flex-end",
  },
  figureWrap: {
    width: STAGE_LAYOUT.figureWidth,
    height: STAGE_LAYOUT.figureHeight,
  },
  tailWrap: {
    position: "absolute",
    zIndex: 0,
  },
  bodyWrap: {
    position: "absolute",
    zIndex: 1,
  },
  leftArmWrap: {
    position: "absolute",
    zIndex: 2,
  },
  rightArmWrap: {
    position: "absolute",
    zIndex: 2,
  },
  headWrap: {
    position: "absolute",
    zIndex: 3,
  },
  partImage: {
    width: "100%",
    height: "100%",
  },
});
