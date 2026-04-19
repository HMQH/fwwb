import { StyleSheet, Text, View } from "react-native";

import { fontFamily, palette, radius } from "@/shared/theme";

import type { GuardianReportBarItem } from "../types";

export function FraudBarChart({ items }: { items: GuardianReportBarItem[] }) {
  if (!items.length) {
    return (
      <View style={styles.emptyWrap}>
        <Text style={styles.emptyText}>暂无类型统计</Text>
      </View>
    );
  }

  const maxValue = Math.max(...items.map((item) => Math.max(0, item.value || 0)), 1);

  return (
    <View style={styles.column}>
      {items.map((item) => {
        const value = Math.max(0, item.value || 0);
        const ratio = Math.max(0.04, value / maxValue);
        return (
          <View key={`${item.label}-${item.value}`} style={styles.row}>
            <Text style={styles.label} numberOfLines={1}>
              {item.label}
            </Text>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${ratio * 100}%` }]} />
            </View>
            <Text style={styles.value}>{value}</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  column: {
    gap: 10,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  label: {
    width: 88,
    color: palette.ink,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  track: {
    flex: 1,
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: palette.surfaceSoft,
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    borderRadius: radius.pill,
    backgroundColor: palette.accentStrong,
  },
  value: {
    width: 32,
    textAlign: "right",
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fontFamily.body,
  },
  emptyWrap: {
    minHeight: 120,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.line,
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
