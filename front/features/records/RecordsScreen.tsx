import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AuthBackdrop, useAuth } from "@/features/auth";
import type { RecordHistoryItem } from "@/features/records/types";
import { ApiError } from "@/shared/api";
import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";

import { recordsApi } from "./api";
import AnimatedList from "./components/AnimatedList";

export default function RecordsScreen() {
  const router = useRouter();
  const { token } = useAuth();
  const [items, setItems] = useState<RecordHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadRecords = useCallback(async () => {
    if (!token) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await recordsApi.list(token, 30);
      setItems(response);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "加载记录失败，请稍后再试。");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      void loadRecords();
    }, [loadRecords])
  );

  const summary = useMemo(() => {
    return items.reduce(
      (acc, item) => {
        const level = item.latest_result?.risk_level;
        if (level === "high") {
          acc.high += 1;
        } else if (level === "medium") {
          acc.medium += 1;
        } else if (level === "low") {
          acc.low += 1;
        }
        return acc;
      },
      { high: 0, medium: 0, low: 0 }
    );
  }, [items]);

  const headerContent = (
    <>
      <View style={styles.headerBlock}>
        <Text style={styles.pageTitle}>检测记录</Text>
        <Text style={styles.pageSubtitle}>每次文本检测都会沉淀成一张可追溯的证据卡片，便于复盘与复查。</Text>
      </View>

      <View style={styles.summaryCard}>
        <View style={styles.summaryTopRow}>
          <Text style={styles.summaryTitle}>最近结果概览</Text>
          <Pressable style={({ pressed }) => [styles.refreshChip, pressed && styles.buttonPressed]} onPress={() => void loadRecords()}>
            <MaterialCommunityIcons name="refresh" size={15} color={palette.accentStrong} />
            <Text style={styles.refreshChipText}>刷新</Text>
          </Pressable>
        </View>
        <View style={styles.metricRow}>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>高风险</Text>
            <Text style={styles.metricValue}>{summary.high}</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>需核验</Text>
            <Text style={styles.metricValue}>{summary.medium}</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>暂低风险</Text>
            <Text style={styles.metricValue}>{summary.low}</Text>
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
              <Text style={styles.emptyTitle}>还没有检测记录</Text>
              <Text style={styles.emptyText}>先去提交一段聊天文本，系统跑完规则与 RAG 后，这里就会出现结果卡片。</Text>
            </View>
          </ScrollView>
        ) : (
          <AnimatedList
            headerContent={headerContent}
            items={items}
            onItemSelect={(item) => router.push({ pathname: "/records/[id]", params: { id: item.submission.id } })}
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
  summaryTitle: {
    color: palette.ink,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: "800",
    fontFamily: fontFamily.display,
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
