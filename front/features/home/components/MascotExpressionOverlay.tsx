import { memo } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Circle, Ellipse, Line, Rect } from "react-native-svg";

import { type MascotVisualState } from "./useMascotState";

type MascotExpressionOverlayProps = {
  state: MascotVisualState;
};

const VIEWBOX_WIDTH = 1092;
const VIEWBOX_HEIGHT = 572;

function MascotBrows({ state }: { state: MascotVisualState }) {
  if (state === "high") {
    return (
      <>
        <Line
          x1={268}
          y1={184}
          x2={420}
          y2={116}
          stroke="#521F19"
          strokeWidth={30}
          strokeLinecap="round"
        />
        <Line
          x1={672}
          y1={116}
          x2={824}
          y2={184}
          stroke="#521F19"
          strokeWidth={30}
          strokeLinecap="round"
        />
      </>
    );
  }

  if (state === "medium") {
    return (
      <>
        <Line
          x1={284}
          y1={172}
          x2={426}
          y2={134}
          stroke="#5E3A1E"
          strokeWidth={26}
          strokeLinecap="round"
        />
        <Line
          x1={668}
          y1={134}
          x2={810}
          y2={172}
          stroke="#5E3A1E"
          strokeWidth={26}
          strokeLinecap="round"
        />
      </>
    );
  }

  return (
    <>
      <Line
        x1={302}
        y1={178}
        x2={430}
        y2={160}
        stroke="rgba(106,69,39,0.72)"
        strokeWidth={22}
        strokeLinecap="round"
      />
      <Line
        x1={662}
        y1={160}
        x2={790}
        y2={178}
        stroke="rgba(106,69,39,0.72)"
        strokeWidth={22}
        strokeLinecap="round"
      />
    </>
  );
}

function MascotMouth({ state }: { state: MascotVisualState }) {
  if (state === "high") {
    return (
      <>
        <Ellipse cx={544} cy={418} rx={154} ry={58} fill="rgba(253,246,235,0.98)" />
        <Ellipse cx={546} cy={426} rx={34} ry={28} fill="#7E2C23" />
        <Ellipse cx={546} cy={426} rx={20} ry={18} fill="rgba(252,245,236,0.92)" />
      </>
    );
  }

  if (state === "medium") {
    return (
      <>
        <Ellipse cx={544} cy={417} rx={146} ry={51} fill="rgba(253,247,236,0.96)" />
        <Line
          x1={490}
          y1={396}
          x2={604}
          y2={396}
          stroke="#502D1A"
          strokeWidth={18}
          strokeLinecap="round"
        />
        <Line
          x1={490}
          y1={396}
          x2={546}
          y2={424}
          stroke="#502D1A"
          strokeWidth={18}
          strokeLinecap="round"
        />
        <Line
          x1={604}
          y1={396}
          x2={546}
          y2={424}
          stroke="#502D1A"
          strokeWidth={18}
          strokeLinecap="round"
        />
      </>
    );
  }

  return null;
}

function MascotBadge({ state }: { state: MascotVisualState }) {
  if (state === "low") {
    return null;
  }

  const fill = state === "high" ? "rgba(232,88,103,0.92)" : "rgba(255,196,84,0.9)";

  return (
    <>
      <Rect x={738} y={state === "high" ? 58 : 70} width={114} height={state === "high" ? 108 : 94} rx={34} fill={fill} />
      <Rect x={788} y={state === "high" ? 82 : 90} width={18} height={state === "high" ? 42 : 32} rx={6} fill="rgba(255,255,255,0.96)" />
      <Circle cx={797} cy={state === "high" ? 146 : 142} r={10} fill="rgba(255,255,255,0.96)" />
    </>
  );
}

export const MascotExpressionOverlay = memo(function MascotExpressionOverlay({
  state,
}: MascotExpressionOverlayProps) {
  return (
    <View pointerEvents="none" style={styles.root}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}>
        <MascotMouth state={state} />
        <MascotBrows state={state} />
        <MascotBadge state={state} />
      </Svg>
    </View>
  );
});

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 3,
  },
});
