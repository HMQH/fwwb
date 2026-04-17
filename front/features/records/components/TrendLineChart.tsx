import { StyleSheet, Text, View } from "react-native";

import type { RecordTrendPoint } from "@/features/records/types";
import { fontFamily, palette, radius } from "@/shared/theme";

const CHART_HEIGHT = 188;
const PAD_X = 18;
const PAD_TOP = 18;
const PAD_BOTTOM = 30;
const LINE_THICKNESS = 2;

const SERIES = [
  { key: "high", label: "高风险", color: "#D85E6A" },
  { key: "medium", label: "需核验", color: "#D68A1F" },
  { key: "low", label: "暂低风险", color: "#2F70E6" },
] as const;

type SeriesKey = (typeof SERIES)[number]["key"];

function pointX(index: number, count: number, width: number) {
  const usableWidth = Math.max(1, width - PAD_X * 2);
  if (count <= 1) {
    return PAD_X + usableWidth / 2;
  }
  return PAD_X + (usableWidth * index) / (count - 1);
}

function pointY(value: number, maxValue: number) {
  const usableHeight = CHART_HEIGHT - PAD_TOP - PAD_BOTTOM;
  if (maxValue <= 0) {
    return PAD_TOP + usableHeight;
  }
  return PAD_TOP + usableHeight - (value / maxValue) * usableHeight;
}

export function TrendLineChart({
  points,
  width,
}: {
  points: RecordTrendPoint[];
  width: number;
}) {
  const maxValue = Math.max(
    1,
    ...points.flatMap((item) => [item.high, item.medium, item.low]),
  );

  if (!points.length) {
    return (
      <View style={styles.emptyWrap}>
        <Text style={styles.emptyText}>暂无趋势数据</Text>
      </View>
    );
  }

  const chartWidth = Math.max(220, width);
  const gridValues = [maxValue, Math.max(0, Math.round(maxValue / 2)), 0];

  return (
    <View style={styles.container}>
      <View style={styles.legendRow}>
        {SERIES.map((item) => (
          <View key={item.key} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: item.color }]} />
            <Text style={styles.legendText}>{item.label}</Text>
          </View>
        ))}
      </View>

      <View style={[styles.chartWrap, { width: chartWidth, height: CHART_HEIGHT }]}>
        {gridValues.map((value, index) => {
          const y = pointY(value, maxValue);
          return (
            <View key={`${value}-${index}`} style={[styles.gridLine, { top: y }]}>
              <Text style={styles.gridLabel}>{value}</Text>
            </View>
          );
        })}

        {SERIES.map((series) =>
          points.map((point, index) => {
            if (index === 0) {
              return null;
            }

            const prev = points[index - 1];
            const x1 = pointX(index - 1, points.length, chartWidth);
            const y1 = pointY(prev[series.key], maxValue);
            const x2 = pointX(index, points.length, chartWidth);
            const y2 = pointY(point[series.key], maxValue);
            const length = Math.hypot(x2 - x1, y2 - y1);
            const angle = Math.atan2(y2 - y1, x2 - x1);
            const midX = (x1 + x2) / 2;
            const midY = (y1 + y2) / 2;

            return (
              <View
                key={`${series.key}-segment-${point.bucket_key}`}
                style={[
                  styles.segment,
                  {
                    backgroundColor: series.color,
                    width: length,
                    left: midX - length / 2,
                    top: midY - LINE_THICKNESS / 2,
                    transform: [{ rotateZ: `${angle}rad` }],
                  },
                ]}
              />
            );
          }),
        )}

        {SERIES.map((series) =>
          points.map((point, index) => {
            const x = pointX(index, points.length, chartWidth);
            const y = pointY(point[series.key], maxValue);
            return (
              <View
                key={`${series.key}-dot-${point.bucket_key}`}
                style={[
                  styles.dot,
                  {
                    left: x - 4,
                    top: y - 4,
                    backgroundColor: series.color,
                  },
                ]}
              />
            );
          }),
        )}

        {points.map((point, index) => {
          const x = pointX(index, points.length, chartWidth);
          return (
            <Text
              key={`label-${point.bucket_key}`}
              style={[
                styles.axisLabel,
                {
                  left: x - 18,
                },
              ]}
              numberOfLines={1}
            >
              {point.label}
            </Text>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 12,
  },
  legendRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: radius.pill,
  },
  legendText: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fontFamily.body,
  },
  chartWrap: {
    position: "relative",
    borderRadius: radius.lg,
    backgroundColor: palette.surfaceSoft,
    overflow: "hidden",
  },
  gridLine: {
    position: "absolute",
    left: PAD_X,
    right: PAD_X,
    borderTopWidth: 1,
    borderTopColor: palette.line,
  },
  gridLabel: {
    position: "absolute",
    left: 0,
    top: -18,
    color: palette.inkSoft,
    fontSize: 10,
    lineHeight: 12,
    fontFamily: fontFamily.body,
  },
  segment: {
    position: "absolute",
    height: LINE_THICKNESS,
    borderRadius: radius.pill,
  },
  dot: {
    position: "absolute",
    width: 8,
    height: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.surface,
  },
  axisLabel: {
    position: "absolute",
    bottom: 8,
    width: 36,
    textAlign: "center",
    color: palette.inkSoft,
    fontSize: 10,
    lineHeight: 12,
    fontFamily: fontFamily.body,
  },
  emptyWrap: {
    minHeight: 180,
    borderRadius: radius.lg,
    backgroundColor: palette.surfaceSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fontFamily.body,
  },
});
