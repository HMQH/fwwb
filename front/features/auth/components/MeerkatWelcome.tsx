import { memo, useEffect, useMemo } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import { Image } from "expo-image";
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import { useReduceMotionEnabled } from "@/shared/useReduceMotionEnabled";

const meerkatSprite = require("../../../assets/images/meerkat_normal.png");

const SPRITE_SIZE = {
  width: 1536,
  height: 1024,
} as const;

const HEAD_BOX = {
  x: 178,
  y: 160,
  width: 479,
  height: 288,
} as const;

const HEAD_EYES = {
  left: { x: 94, y: 93, width: 106, height: 97 },
  right: { x: 277, y: 93, width: 107, height: 97 },
} as const;

const DESIGN = {
  stageWidth: 196,
  stageHeight: 154,
  headLeft: 13,
  headTop: 20,
  headWidth: 170,
  haloLeft: 38,
  haloTop: 2,
  haloSize: 118,
} as const;

type SpriteBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function getDisplayHeight(box: SpriteBox, displayWidth: number) {
  return (box.height / box.width) * displayWidth;
}

function SpriteSlice({
  box,
  width,
}: {
  box: SpriteBox;
  width: number;
}) {
  const scale = width / box.width;
  const height = getDisplayHeight(box, width);

  return (
    <View style={{ width, height, overflow: "hidden" }}>
      <Image
        source={meerkatSprite}
        style={{
          width: SPRITE_SIZE.width * scale,
          height: SPRITE_SIZE.height * scale,
          transform: [{ translateX: -box.x * scale }, { translateY: -box.y * scale }],
        }}
        contentFit="fill"
        cachePolicy="memory-disk"
        accessible={false}
      />
    </View>
  );
}

function EyeBlink({
  box,
  headWidth,
  blink,
}: {
  box: SpriteBox;
  headWidth: number;
  blink: SharedValue<number>;
}) {
  const scale = headWidth / HEAD_BOX.width;
  const width = box.width * scale;
  const height = box.height * scale;

  const shellStyle = useMemo(
    () => ({
      left: box.x * scale,
      top: box.y * scale,
      width,
      height,
    }),
    [box.x, box.y, height, scale, width]
  );

  const topLidStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY: interpolate(blink.value, [0, 1], [-height * 0.58, 0]),
      },
      {
        scaleY: interpolate(blink.value, [0, 1], [0.88, 1]),
      },
    ],
  }));

  const bottomLidStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY: interpolate(blink.value, [0, 1], [height * 0.58, 0]),
      },
      {
        scaleY: interpolate(blink.value, [0, 1], [0.88, 1]),
      },
    ],
  }));

  const creaseStyle = useAnimatedStyle(() => ({
    opacity: interpolate(blink.value, [0, 0.72, 1], [0, 0.06, 0.92]),
    transform: [{ scaleX: interpolate(blink.value, [0, 1], [0.72, 1]) }],
  }));

  return (
    <View pointerEvents="none" style={[styles.eyeShell, shellStyle]}>
      <Animated.View style={[styles.eyeTopLid, topLidStyle]} />
      <Animated.View style={[styles.eyeBottomLid, bottomLidStyle]} />
      <Animated.View style={[styles.eyeCrease, creaseStyle]} />
    </View>
  );
}

function MeerkatWelcomeComponent() {
  const { width: screenWidth } = useWindowDimensions();
  const reduceMotion = useReduceMotionEnabled();

  const reveal = useSharedValue(0);
  const blink = useSharedValue(0);
  const float = useSharedValue(0);
  const breathe = useSharedValue(0);
  const glow = useSharedValue(0);

  const stageWidth = Math.min(Math.max(screenWidth - 176, 156), 204);
  const scale = stageWidth / DESIGN.stageWidth;
  const stageHeight = DESIGN.stageHeight * scale;
  const headWidth = DESIGN.headWidth * scale;
  const headHeight = getDisplayHeight(HEAD_BOX, headWidth);

  const metrics = useMemo(
    () => ({
      stageWidth,
      stageHeight,
      head: {
        left: DESIGN.headLeft * scale,
        top: DESIGN.headTop * scale,
        width: headWidth,
        height: headHeight,
      },
      halo: {
        left: DESIGN.haloLeft * scale,
        top: DESIGN.haloTop * scale,
        size: DESIGN.haloSize * scale,
      },
    }),
    [headHeight, headWidth, scale, stageHeight, stageWidth]
  );

  useEffect(() => {
    cancelAnimation(reveal);
    cancelAnimation(blink);
    cancelAnimation(float);
    cancelAnimation(breathe);
    cancelAnimation(glow);

    if (reduceMotion) {
      reveal.value = 1;
      blink.value = 0;
      float.value = 0.5;
      breathe.value = 0.45;
      glow.value = 0.36;
      return;
    }

    reveal.value = 0;
    blink.value = 0;
    float.value = 0;
    breathe.value = 0;
    glow.value = 0;

    reveal.value = withTiming(1, {
      duration: 620,
      easing: Easing.out(Easing.cubic),
    });

    blink.value = withDelay(
      1020,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 92, easing: Easing.out(Easing.quad) }),
          withTiming(0, { duration: 118, easing: Easing.out(Easing.quad) }),
          withDelay(2400, withTiming(0, { duration: 0 }))
        ),
        -1,
        false
      )
    );

    float.value = withDelay(
      760,
      withRepeat(
        withTiming(1, {
          duration: 2100,
          easing: Easing.inOut(Easing.quad),
        }),
        -1,
        true
      )
    );

    breathe.value = withDelay(
      760,
      withRepeat(
        withTiming(1, {
          duration: 1800,
          easing: Easing.inOut(Easing.quad),
        }),
        -1,
        true
      )
    );

    glow.value = withDelay(
      760,
      withRepeat(
        withTiming(1, {
          duration: 2400,
          easing: Easing.inOut(Easing.quad),
        }),
        -1,
        true
      )
    );
  }, [blink, breathe, float, glow, reduceMotion, reveal]);

  const haloStyle = useAnimatedStyle(() => ({
    opacity: interpolate(glow.value, [0, 1], [0.42, 0.72]),
    transform: [{ scale: interpolate(glow.value, [0, 1], [0.96, 1.04]) }],
  }));

  const headStyle = useAnimatedStyle(() => ({
    opacity: interpolate(reveal.value, [0, 1], [0, 1]),
    transform: [
      {
        translateY:
          interpolate(reveal.value, [0, 1], [26 * scale, 0]) +
          interpolate(float.value, [0, 1], [1.5, -3.5]),
      },
      {
        rotate: `${interpolate(float.value, [0, 1], [-0.8, 0.6])}deg`,
      },
      {
        scaleX: interpolate(breathe.value, [0, 1], [0.994, 1.008]),
      },
      {
        scaleY: interpolate(breathe.value, [0, 1], [1, 1.016]),
      },
    ],
  }));

  return (
    <View pointerEvents="none" style={[styles.root, { height: stageHeight }]}>
      <View style={[styles.stage, { width: metrics.stageWidth, height: metrics.stageHeight }]}>
        <Animated.View
          style={[
            styles.halo,
            haloStyle,
            {
              left: metrics.halo.left,
              top: metrics.halo.top,
              width: metrics.halo.size,
              height: metrics.halo.size,
              borderRadius: metrics.halo.size / 2,
            },
          ]}
        />

        <Animated.View
          style={[
            styles.headWrap,
            headStyle,
            {
              left: metrics.head.left,
              top: metrics.head.top,
            },
          ]}
        >
          <SpriteSlice box={HEAD_BOX} width={metrics.head.width} />
          <EyeBlink box={HEAD_EYES.left} headWidth={metrics.head.width} blink={blink} />
          <EyeBlink box={HEAD_EYES.right} headWidth={metrics.head.width} blink={blink} />
        </Animated.View>
      </View>
    </View>
  );
}

export const MeerkatWelcome = memo(MeerkatWelcomeComponent);

const styles = StyleSheet.create({
  root: {
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  stage: {
    position: "relative",
  },
  halo: {
    position: "absolute",
    backgroundColor: "rgba(226, 239, 255, 0.9)",
    borderWidth: 1,
    borderColor: "rgba(166, 197, 248, 0.4)",
  },
  headWrap: {
    position: "absolute",
  },
  eyeShell: {
    position: "absolute",
    overflow: "hidden",
    borderRadius: 999,
  },
  eyeTopLid: {
    position: "absolute",
    top: 0,
    left: "-8%",
    width: "116%",
    height: "62%",
    borderBottomLeftRadius: 999,
    borderBottomRightRadius: 999,
    backgroundColor: "#F7BC66",
  },
  eyeBottomLid: {
    position: "absolute",
    bottom: 0,
    left: "-6%",
    width: "112%",
    height: "56%",
    borderTopLeftRadius: 999,
    borderTopRightRadius: 999,
    backgroundColor: "#FCF3E1",
  },
  eyeCrease: {
    position: "absolute",
    left: "8%",
    right: "8%",
    top: "48%",
    height: 2,
    borderRadius: 999,
    backgroundColor: "#503222",
  },
});
