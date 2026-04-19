import { memo, useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";

import { fontFamily, palette, radius } from "@/shared/theme";

type Series = {
  times?: number[] | null;
  values?: number[] | null;
};

function buildPath(values: number[], width: number, height: number) {
  if (!values.length) {
    return "";
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 1e-6);
  return values
    .map((value, index) => {
      const x = (index / Math.max(values.length - 1, 1)) * width;
      const y = height - ((value - min) / span) * height;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

export const SignalLineChart = memo(function SignalLineChart({
  title,
  subtitle,
  color,
  series,
  emptyLabel = "暂无可视化数据",
}: {
  title: string;
  subtitle?: string;
  color: string;
  series?: Series | null;
  emptyLabel?: string;
}) {
  const values = Array.isArray(series?.values) ? series?.values.filter((value) => Number.isFinite(value)) as number[] : [];
  const path = useMemo(() => buildPath(values, 280, 88), [values]);
  const min = values.length ? Math.min(...values) : null;
  const max = values.length ? Math.max(...values) : null;
  const latest = values.length ? values[values.length - 1] : null;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.copy}>
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
        {latest !== null ? (
          <View style={[styles.badge, { backgroundColor: `${color}18` }]}>
            <Text style={[styles.badgeText, { color }]}>{latest.toFixed(2)}</Text>
          </View>
        ) : null}
      </View>

      {values.length ? (
        <>
          <View style={styles.chartWrap}>
            <Svg width="100%" height={98} viewBox="0 0 280 98">
              <Path d={path} stroke={color} strokeWidth={2.6} fill="none" strokeLinejoin="round" strokeLinecap="round" />
            </Svg>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaText}>最小 {min?.toFixed(2) ?? "--"}</Text>
            <Text style={styles.metaText}>最大 {max?.toFixed(2) ?? "--"}</Text>
            <Text style={styles.metaText}>点数 {values.length}</Text>
          </View>
        </>
      ) : (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyText}>{emptyLabel}</Text>
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.xl,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: "#DCE8FA",
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 10,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  copy: {
    flex: 1,
    gap: 4,
  },
  title: {
    color: palette.ink,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  subtitle: {
    color: palette.inkSoft,
    fontSize: 11,
    lineHeight: 15,
    fontFamily: fontFamily.body,
  },
  badge: {
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  badgeText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  chartWrap: {
    height: 98,
    justifyContent: "center",
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  metaText: {
    color: palette.inkSoft,
    fontSize: 11,
    lineHeight: 14,
    fontFamily: fontFamily.body,
  },
  emptyWrap: {
    borderRadius: radius.lg,
    backgroundColor: "#F6FAFF",
    paddingHorizontal: 12,
    paddingVertical: 16,
  },
  emptyText: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fontFamily.body,
  },
});
