import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { AuthBackdrop, useAuth } from "@/features/auth";
import type { RecordHistoryItem, RecordScope, RecordStatistics } from "@/features/records/types";
import { ApiError } from "@/shared/api";
import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";
import { useReduceMotionEnabled } from "@/shared/useReduceMotionEnabled";

import { recordsApi } from "./api";
import AnimatedList from "./components/AnimatedList";

const MEERKAT_ASSISTANT = require("../../assets/images/meerkat_assitant.png");

const PAGE_SIZE = 12;
const SCOPE_OPTIONS: Array<{ key: RecordScope; label: string }> = [
  { key: "day", label: "日" },
  { key: "month", label: "月" },
  { key: "year", label: "年" },
];

function mergeRecords(current: RecordHistoryItem[], incoming: RecordHistoryItem[]) {
  const seen = new Set(current.map((item) => item.submission.id));
  const merged = [...current];

  for (const item of incoming) {
    if (seen.has(item.submission.id)) {
      continue;
    }
    seen.add(item.submission.id);
    merged.push(item);
  }

  return merged;
}

function scopeHint(scope: RecordScope) {
  if (scope === "day") {
    return "今天";
  }
  if (scope === "year") {
    return "今年";
  }
  return "本月";
}

function buildFallbackStatistics(scope: RecordScope, items: RecordHistoryItem[]): RecordStatistics {
  const stats = items.reduce(
    (acc, item) => {
      const level = item.latest_result?.risk_level;
      acc.filtered_total += 1;
      if (level === "high") {
        acc.high_count += 1;
      } else if (level === "medium") {
        acc.medium_count += 1;
      } else if (level === "low") {
        acc.low_count += 1;
      }
      return acc;
    },
    {
      scope,
      total_records: items.length,
      filtered_total: 0,
      high_count: 0,
      medium_count: 0,
      low_count: 0,
      points: [],
    } satisfies RecordStatistics,
  );

  return stats;
}

const MASCOT_FLOAT_PX = 5;
const MASCOT_FLOAT_MS = 1800;

function RecordsSummaryMascot({ imageSource }: { imageSource: number }) {
  const reduceMotion = useReduceMotionEnabled();
  const drift = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) {
      drift.value = 0;
      return;
    }
    drift.value = withRepeat(
      withTiming(-MASCOT_FLOAT_PX, {
        duration: MASCOT_FLOAT_MS,
        easing: Easing.inOut(Easing.sin),
      }),
      -1,
      true,
    );
  }, [drift, reduceMotion]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: drift.value }],
  }));

  return (
    <Animated.View pointerEvents="none" style={[styles.summaryMascot, animatedStyle]}>
      <Image accessibilityLabel="猫鼬助手" resizeMode="contain" source={imageSource} style={styles.summaryMascotImage} />
    </Animated.View>
  );
}

export default function RecordsScreen() {
  const router = useRouter();
  const { token } = useAuth();

  const [scope, setScope] = useState<RecordScope>("month");
  const [items, setItems] = useState<RecordHistoryItem[]>([]);
  const [statistics, setStatistics] = useState<RecordStatistics | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const scopeRef = useRef<RecordScope>("month");
  const itemsRef = useRef<RecordHistoryItem[]>([]);
  const itemCountRef = useRef(0);
  const hasMoreRef = useRef(true);
  const loadingRef = useRef(true);
  const refreshingRef = useRef(false);
  const loadingMoreRef = useRef(false);

  scopeRef.current = scope;
  itemsRef.current = items;
  itemCountRef.current = items.length;
  hasMoreRef.current = hasMore;
  loadingRef.current = loading;
  refreshingRef.current = refreshing;

  const loadStatistics = useCallback(
    async (targetScope: RecordScope) => {
      if (!token) {
        setStatistics(null);
        return;
      }

      try {
        const response = await recordsApi.statistics(token, targetScope);
        if (scopeRef.current === targetScope) {
          setStatistics(response);
        }
      } catch {
        if (scopeRef.current === targetScope) {
          setStatistics((prev) => prev ?? buildFallbackStatistics(targetScope, itemsRef.current));
        }
      }
    },
    [token],
  );

  const loadRecords = useCallback(
    async (mode: "reset" | "append" = "reset", targetScope?: RecordScope) => {
      const nextScope = targetScope ?? scopeRef.current;

      if (!token) {
        setItems([]);
        setStatistics(null);
        setHasMore(false);
        setRefreshing(false);
        setLoadingMore(false);
        setError(null);
        setLoading(false);
        return;
      }

      const isReset = mode === "reset";
      const hadItems = itemCountRef.current > 0;

      if (!isReset) {
        if (!hasMoreRef.current || loadingRef.current || refreshingRef.current || loadingMoreRef.current) {
          return;
        }
        loadingMoreRef.current = true;
        setLoadingMore(true);
      } else {
        loadingMoreRef.current = false;
        setError(null);
        setHasMore(true);
        if (hadItems) {
          setRefreshing(true);
        } else {
          setLoading(true);
        }
      }

      try {
        const offset = isReset ? 0 : itemCountRef.current;
        const response = await recordsApi.list(token, PAGE_SIZE, offset, nextScope);

        if (scopeRef.current !== nextScope) {
          return;
        }

        setItems((prev) => (isReset ? response : mergeRecords(prev, response)));
        setHasMore(response.length === PAGE_SIZE);
      } catch (err) {
        const message = err instanceof ApiError ? err.message : "加载记录失败，请稍后再试。";
        if (isReset && !hadItems) {
          setError(message);
        } else {
          Alert.alert("加载失败", message);
        }
      } finally {
        if (scopeRef.current === nextScope) {
          if (isReset) {
            setLoading(false);
            setRefreshing(false);
          } else {
            loadingMoreRef.current = false;
            setLoadingMore(false);
          }
        }
      }
    },
    [token],
  );

  const reloadScopeData = useCallback(
    async (targetScope: RecordScope, mode: "reset" | "append" = "reset") => {
      if (mode === "reset") {
        await Promise.all([
          loadRecords("reset", targetScope),
          loadStatistics(targetScope),
        ]);
        return;
      }

      await loadRecords("append", targetScope);
    },
    [loadRecords, loadStatistics],
  );

  useFocusEffect(
    useCallback(() => {
      void reloadScopeData(scopeRef.current, "reset");
    }, [reloadScopeData]),
  );

  const handleScopeChange = useCallback(
    (nextScope: RecordScope) => {
      if (nextScope === scopeRef.current) {
        return;
      }
      scopeRef.current = nextScope;
      setScope(nextScope);
      setItems([]);
      setStatistics(null);
      setHasMore(true);
      setError(null);
      setLoading(true);
      void reloadScopeData(nextScope, "reset");
    },
    [reloadScopeData],
  );

  const handleLoadMore = useCallback(() => {
    if (!items.length || loading || refreshing || loadingMore || !hasMore) {
      return;
    }
    void reloadScopeData(scopeRef.current, "append");
  }, [hasMore, items.length, loading, loadingMore, refreshing, reloadScopeData]);

  const summary = useMemo(
    () =>
      statistics ?? {
        scope,
        total_records: items.length,
        filtered_total: items.length,
        high_count: 0,
        medium_count: 0,
        low_count: 0,
        points: [],
      },
    [items.length, scope, statistics],
  );

  const headerContent = (
    <>
      <View style={styles.headerBlock}>
        <View style={styles.headerTopRow}>
          <View style={styles.headerCopy}>
            <Text style={styles.pageTitle}>检测记录</Text>
            <Text style={styles.pageSubtitle}>默认展示{scopeHint(scope)}记录</Text>
          </View>
          <Pressable
            style={({ pressed }) => [styles.analysisButton, pressed && styles.buttonPressed]}
            onPress={() => router.push("/records/analytics")}
          >
            <MaterialCommunityIcons name="chart-line" size={16} color={palette.accentStrong} />
            <Text style={styles.analysisButtonText}>分析</Text>
          </Pressable>
        </View>

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
                onPress={() => handleScopeChange(item.key)}
              >
                <Text style={[styles.scopeChipText, active && styles.scopeChipTextActive]}>{item.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.summaryCardWrap} pointerEvents="box-none">
        <RecordsSummaryMascot imageSource={MEERKAT_ASSISTANT} />
        <View style={styles.summaryCard}>
          <View style={styles.summaryTopRow}>
            <View style={styles.summaryCopy}>
              <Text style={styles.summaryTitle}>记录总数</Text>
              <Text style={styles.summaryHint}>用户全部记录</Text>
            </View>
            <View style={styles.summaryTotalPill}>
              <Text style={styles.summaryTotalValue}>{summary.total_records}</Text>
            </View>
          </View>

          <View style={styles.metricRow}>
            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>高风险</Text>
              <Text style={styles.metricValue}>{summary.high_count}</Text>
            </View>
            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>需核验</Text>
              <Text style={styles.metricValue}>{summary.medium_count}</Text>
            </View>
            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>暂低风险</Text>
              <Text style={styles.metricValue}>{summary.low_count}</Text>
            </View>
          </View>

          <View style={styles.scopeSummaryBar}>
            <Text style={styles.scopeSummaryText}>
              {scopeHint(scope)}记录 {summary.filtered_total}
            </Text>
            <Pressable style={({ pressed }) => [styles.refreshChip, pressed && styles.buttonPressed]} onPress={() => void reloadScopeData(scope, "reset")}>
              <MaterialCommunityIcons name="refresh" size={15} color={palette.accentStrong} />
              <Text style={styles.refreshChipText}>{refreshing ? "刷新中" : "刷新"}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </>
  );

  return (
    <View style={styles.root}>
      <AuthBackdrop />
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        {loading ? (
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            {headerContent}
            <View style={styles.loadingCard}>
              <ActivityIndicator size="small" color={palette.accentStrong} />
              <Text style={styles.loadingText}>正在加载检测记录…</Text>
            </View>
          </ScrollView>
        ) : error ? (
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            {headerContent}
            <View style={styles.errorCard}>
              <Text style={styles.errorTitle}>记录加载失败</Text>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          </ScrollView>
        ) : items.length === 0 ? (
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            {headerContent}
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>当前范围暂无记录</Text>
              <Text style={styles.emptyText}>切换日、月、年，或稍后再看。</Text>
            </View>
          </ScrollView>
        ) : (
          <AnimatedList
            headerContent={headerContent}
            items={items}
            loadingMore={loadingMore}
            onEndReached={handleLoadMore}
            onItemSelect={(item) => router.push({ pathname: "/records/[id]", params: { id: item.submission.id } })}
            onRefresh={() => void reloadScopeData(scope, "reset")}
            refreshing={refreshing}
            showGradients
            displayScrollbar={false}
          />
        )}
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
  content: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 24,
    gap: 16,
  },
  headerBlock: {
    gap: 12,
  },
  headerTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  headerCopy: {
    flex: 1,
    gap: 4,
  },
  pageTitle: {
    color: palette.ink,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  pageSubtitle: {
    color: palette.inkSoft,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: fontFamily.body,
  },
  analysisButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: radius.pill,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 12,
    paddingVertical: 9,
    ...panelShadow,
  },
  analysisButtonText: {
    color: palette.accentStrong,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  scopeRow: {
    flexDirection: "row",
    gap: 10,
  },
  scopeChip: {
    minWidth: 46,
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
  summaryCardWrap: {
    position: "relative",
    overflow: "visible",
    zIndex: 1,
  },
  summaryMascot: {
    position: "absolute",
    right: 80,
    top: -42,
    width: 100,
    height: 100,
    zIndex: 2,
  },
  summaryMascotImage: {
    width: "100%",
    height: "100%",
  },
  summaryCard: {
    borderRadius: radius.xl,
    paddingHorizontal: 18,
    paddingVertical: 18,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    gap: 12,
    ...panelShadow,
  },
  summaryTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  summaryCopy: {
    gap: 4,
  },
  summaryTitle: {
    color: palette.ink,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  summaryHint: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fontFamily.body,
  },
  summaryTotalPill: {
    minWidth: 60,
    borderRadius: radius.pill,
    backgroundColor: palette.accentSoft,
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignItems: "center",
  },
  summaryTotalValue: {
    color: palette.accentStrong,
    fontSize: 18,
    lineHeight: 22,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  metricRow: {
    flexDirection: "row",
    gap: 10,
  },
  metricCard: {
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
  scopeSummaryBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  scopeSummaryText: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fontFamily.body,
  },
  refreshChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: radius.pill,
    backgroundColor: palette.accentSoft,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  refreshChipText: {
    color: palette.accentStrong,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  loadingCard: {
    borderRadius: radius.lg,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    paddingVertical: 22,
    alignItems: "center",
    gap: 10,
    ...panelShadow,
  },
  loadingText: {
    color: palette.inkSoft,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  errorCard: {
    borderRadius: radius.lg,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: "#F0C9BE",
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 6,
    ...panelShadow,
  },
  errorTitle: {
    color: palette.ink,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  errorText: {
    color: palette.inkSoft,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  emptyCard: {
    borderRadius: radius.lg,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 18,
    paddingVertical: 18,
    gap: 8,
    ...panelShadow,
  },
  emptyTitle: {
    color: palette.ink,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  emptyText: {
    color: palette.inkSoft,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  buttonPressed: {
    transform: [{ scale: 0.98 }],
  },
});
