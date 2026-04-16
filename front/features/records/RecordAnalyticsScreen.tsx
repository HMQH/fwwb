import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AuthBackdrop, useAuth } from "@/features/auth";
import type { RecordScope, RecordStatistics } from "@/features/records/types";
import { ApiError } from "@/shared/api";
import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";

import { recordsApi } from "./api";
import { TrendLineChart } from "./components/TrendLineChart";

const SCOPE_OPTIONS: Array<{ key: RecordScope; label: string }> = [
  { key: "day", label: "日" },
  { key: "month", label: "月" },
  { key: "year", label: "年" },
];

function scopeHint(scope: RecordScope) {
  if (scope === "day") {
    return "按日";
  }
  if (scope === "year") {
    return "按年";
  }
  return "按月";
}

export default function RecordAnalyticsScreen() {
  const router = useRouter();
  const { token } = useAuth();
  const { width } = useWindowDimensions();

  const [scope, setScope] = useState<RecordScope>("month");
  const [statistics, setStatistics] = useState<RecordStatistics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadStatistics = useCallback(
    async (targetScope: RecordScope) => {
      if (!token) {
        setStatistics(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const response = await recordsApi.statistics(token, targetScope);
        setStatistics(response);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "加载分析失败");
      } finally {
        setLoading(false);
      }
    },
    [token],
  );

  useFocusEffect(
    useCallback(() => {
      void loadStatistics(scope);
    }, [loadStatistics, scope]),
  );

  const recentPoints = useMemo(() => statistics?.points.slice(-6) ?? [], [statistics?.points]);

  return (
    <View style={styles.root}>
      <AuthBackdrop />
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <View style={styles.header}>
          <Pressable style={({ pressed }) => [styles.iconButton, pressed && styles.buttonPressed]} onPress={() => router.replace("/records")}>
            <MaterialCommunityIcons name="chevron-left" size={20} color={palette.accentStrong} />
          </Pressable>
          <View style={styles.headerCopy}>
            <Text style={styles.pageTitle}>数据分析</Text>
            <Text style={styles.pageSubtitle}>{scopeHint(scope)}趋势</Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.scopeRow}>
            {SCOPE_OPTIONS.map((item) => {
              const active = item.key === scope;
              return (
                <Pressable
                  key={item.key}
                  style={({ pressed }) => [
                    styles.scopeChip,
                    active && styles.scopeChipActive,
                    pressed && styles.buttonPressed,
                  ]}
                  onPress={() => setScope(item.key)}
                >
                  <Text style={[styles.scopeChipText, active && styles.scopeChipTextActive]}>{item.label}</Text>
                </Pressable>
              );
            })}
          </View>

          {loading ? (
            <View style={styles.stateCard}>
              <ActivityIndicator size="small" color={palette.accentStrong} />
              <Text style={styles.stateText}>正在生成趋势图…</Text>
            </View>
          ) : error || !statistics ? (
            <View style={styles.stateCard}>
              <Text style={styles.stateTitle}>加载失败</Text>
              <Text style={styles.stateText}>{error ?? "暂无数据"}</Text>
            </View>
          ) : (
            <>
              <View style={styles.heroCard}>
                <View style={styles.heroTopRow}>
                  <View>
                    <Text style={styles.heroLabel}>全部记录</Text>
                    <Text style={styles.heroValue}>{statistics.total_records}</Text>
                  </View>
                  <View style={styles.heroRangePill}>
                    <Text style={styles.heroRangeText}>{scopeHint(scope)}</Text>
                  </View>
                </View>

                <View style={styles.metricRow}>
                  <View style={styles.metricCard}>
                    <Text style={styles.metricLabel}>当前范围</Text>
                    <Text style={styles.metricValue}>{statistics.filtered_total}</Text>
                  </View>
                  <View style={styles.metricCard}>
                    <Text style={styles.metricLabel}>高风险</Text>
                    <Text style={styles.metricValue}>{statistics.high_count}</Text>
                  </View>
                  <View style={styles.metricCard}>
                    <Text style={styles.metricLabel}>需核验</Text>
                    <Text style={styles.metricValue}>{statistics.medium_count}</Text>
                  </View>
                  <View style={styles.metricCard}>
                    <Text style={styles.metricLabel}>暂低风险</Text>
                    <Text style={styles.metricValue}>{statistics.low_count}</Text>
                  </View>
                </View>
              </View>

              <View style={styles.chartCard}>
                <View style={styles.chartHeader}>
                  <Text style={styles.chartTitle}>风险趋势</Text>
                  <Text style={styles.chartHint}>高风险 / 需核验 / 暂低风险</Text>
                </View>
                <TrendLineChart points={statistics.points} width={width - 64} />
              </View>

              <View style={styles.listCard}>
                <Text style={styles.listTitle}>最近节点</Text>
                <View style={styles.pointList}>
                  {recentPoints.map((item) => (
                    <View key={item.bucket_key} style={styles.pointRow}>
                      <Text style={styles.pointLabel}>{item.label}</Text>
                      <View style={styles.pointValues}>
                        <Text style={[styles.pointValue, styles.highText]}>高 {item.high}</Text>
                        <Text style={[styles.pointValue, styles.mediumText]}>中 {item.medium}</Text>
                        <Text style={[styles.pointValue, styles.lowText]}>低 {item.low}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: palette.background,
  },
  safeArea: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 12,
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    alignItems: "center",
    justifyContent: "center",
  },
  headerCopy: {
    flex: 1,
    gap: 2,
  },
  pageTitle: {
    color: palette.ink,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  pageSubtitle: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fontFamily.body,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 28,
    gap: 16,
  },
  scopeRow: {
    flexDirection: "row",
    gap: 10,
  },
  scopeChip: {
    minWidth: 52,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    alignItems: "center",
  },
  scopeChipActive: {
    backgroundColor: palette.accentSoft,
    borderColor: palette.accentStrong,
  },
  scopeChipText: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  scopeChipTextActive: {
    color: palette.accentStrong,
  },
  stateCard: {
    borderRadius: radius.lg,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    paddingVertical: 28,
    alignItems: "center",
    gap: 10,
    ...panelShadow,
  },
  stateTitle: {
    color: palette.ink,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  stateText: {
    color: palette.inkSoft,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  heroCard: {
    borderRadius: radius.xl,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 18,
    paddingVertical: 18,
    gap: 14,
    ...panelShadow,
  },
  heroTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  heroLabel: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fontFamily.body,
  },
  heroValue: {
    color: palette.ink,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  heroRangePill: {
    borderRadius: radius.pill,
    backgroundColor: palette.accentSoft,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  heroRangeText: {
    color: palette.accentStrong,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  metricRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  metricCard: {
    minWidth: "47%",
    flex: 1,
    borderRadius: radius.md,
    backgroundColor: palette.surfaceSoft,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 4,
  },
  metricLabel: {
    color: palette.inkSoft,
    fontSize: 11,
    lineHeight: 14,
    fontFamily: fontFamily.body,
  },
  metricValue: {
    color: palette.ink,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  chartCard: {
    borderRadius: radius.xl,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 12,
    ...panelShadow,
  },
  chartHeader: {
    gap: 4,
  },
  chartTitle: {
    color: palette.ink,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  chartHint: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fontFamily.body,
  },
  listCard: {
    borderRadius: radius.xl,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 12,
    ...panelShadow,
  },
  listTitle: {
    color: palette.ink,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  pointList: {
    gap: 10,
  },
  pointRow: {
    borderRadius: radius.md,
    backgroundColor: palette.surfaceSoft,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 8,
  },
  pointLabel: {
    color: palette.ink,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  pointValues: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  pointValue: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  highText: {
    color: "#D85E6A",
  },
  mediumText: {
    color: "#D68A1F",
  },
  lowText: {
    color: "#2F70E6",
  },
  buttonPressed: {
    transform: [{ scale: 0.98 }],
  },
});
