import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";

import { fontFamily, palette, radius } from "@/shared/theme";

import type { GuardianReportPieSegment } from "../types";

const CHART_SIZE = 168;
const STROKE_WIDTH = 18;
const RADIUS = (CHART_SIZE - STROKE_WIDTH) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function PieRiskChart({ segments }: { segments: GuardianReportPieSegment[] }) {
  const total = segments.reduce((sum, item) => sum + Math.max(0, item.value || 0), 0);

  if (total <= 0) {
    return (
      <View style={styles.emptyWrap}>
        <Text style={styles.emptyText}>暂无分布数据</Text>
      </View>
    );
  }

  let dashOffsetCursor = 0;
  const ringItems = segments.map((item) => {
    const value = Math.max(0, item.value || 0);
    const sliceLength = (value / total) * CIRCUMFERENCE;
    const ring = {
      ...item,
      sliceLength,
      dashOffset: -dashOffsetCursor,
    };
    dashOffsetCursor += sliceLength;
    return ring;
  });

  return (
    <View style={styles.container}>
      <View style={styles.chartWrap}>
        <Svg width={CHART_SIZE} height={CHART_SIZE}>
          <Circle
            cx={CHART_SIZE / 2}
            cy={CHART_SIZE / 2}
            r={RADIUS}
            stroke={palette.line}
            strokeWidth={STROKE_WIDTH}
            fill="none"
          />
          {ringItems.map((item) => (
            <Circle
              key={item.key}
              cx={CHART_SIZE / 2}
              cy={CHART_SIZE / 2}
              r={RADIUS}
              stroke={item.color || palette.accentStrong}
              strokeWidth={STROKE_WIDTH}
              strokeLinecap="butt"
              fill="none"
              strokeDasharray={`${item.sliceLength} ${Math.max(0, CIRCUMFERENCE - item.sliceLength)}`}
              strokeDashoffset={item.dashOffset}
              transform={`rotate(-90 ${CHART_SIZE / 2} ${CHART_SIZE / 2})`}
            />
          ))}
        </Svg>
        <View style={styles.centerLabel}>
          <Text style={styles.centerValue}>{total}</Text>
          <Text style={styles.centerCaption}>总条数</Text>
        </View>
      </View>

      <View style={styles.legendColumn}>
        {segments.map((item) => {
          const ratio = total > 0 ? `${Math.round((item.value / total) * 100)}%` : "0%";
          return (
            <View key={item.key} style={styles.legendRow}>
              <View style={[styles.dot, { backgroundColor: item.color || palette.accentStrong }]} />
              <Text style={styles.legendLabel}>{item.label}</Text>
              <Text style={styles.legendValue}>
                {item.value} · {ratio}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 14,
  },
  chartWrap: {
    alignSelf: "center",
    width: CHART_SIZE,
    height: CHART_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  centerLabel: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  centerValue: {
    color: palette.ink,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  centerCaption: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fontFamily.body,
  },
  legendColumn: {
    gap: 8,
  },
  legendRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: radius.md,
    backgroundColor: palette.surfaceSoft,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: radius.pill,
  },
  legendLabel: {
    flex: 1,
    color: palette.ink,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  legendValue: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fontFamily.body,
  },
  emptyWrap: {
    minHeight: 140,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.line,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.surfaceSoft,
  },
  emptyText: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fontFamily.body,
  },
});
