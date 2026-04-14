import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AuthBackdrop, useAuth } from "@/features/auth";
import { getRiskMeta } from "@/features/detections";
import type { RecordHistoryItem } from "@/features/records/types";
import { ApiError } from "@/shared/api";
import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";

import { recordsApi } from "./api";

function formatDateTime(value?: string | null) {
  if (!value) {
    return "--";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function statusLabel(item: RecordHistoryItem) {
  const status = item.latest_job?.status;
  if (status === "pending") {
    return "排队中";
  }
  if (status === "running") {
    return "分析中";
  }
  if (status === "failed") {
    return "失败";
  }
  return item.latest_result ? "已完成" : "已提交";
}

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

  return (
    <View style={styles.root}>
      <AuthBackdrop />
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
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

          {loading ? (
            <View style={styles.loadingCard}>
              <ActivityIndicator size="small" color={palette.accentStrong} />
              <Text style={styles.loadingText}>正在加载检测记录…</Text>
            </View>
          ) : error ? (
            <View style={styles.errorCard}>
              <Text style={styles.errorTitle}>记录加载失败</Text>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : items.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>还没有检测记录</Text>
              <Text style={styles.emptyText}>先去提交一段聊天文本，系统跑完规则与 RAG 后，这里就会出现结果卡片。</Text>
            </View>
          ) : (
            <View style={styles.listCard}>
              {items.map((item, index) => {
                const meta = getRiskMeta(item.latest_result?.risk_level);
                return (
                  <Pressable
                    key={item.submission.id}
                    style={({ pressed }) => [styles.recordRow, index < items.length - 1 && styles.rowDivider, pressed && styles.rowPressed]}
                    onPress={() => router.push({ pathname: "/records/[id]", params: { id: item.submission.id } })}
                  >
                    <View style={[styles.recordIconWrap, { backgroundColor: meta.soft }]}>
                      <MaterialCommunityIcons name={meta.icon} size={20} color={meta.tone} />
                    </View>

                    <View style={styles.recordBody}>
                      <View style={styles.recordTop}>
                        <Text style={styles.recordTitle} numberOfLines={1}>
                          {item.latest_result?.fraud_type ?? "待分析文本"}
                        </Text>
                        <Text style={styles.recordTime}>{formatDateTime(item.submission.created_at)}</Text>
                      </View>

                      <View style={styles.metaLine}>
                        <View style={[styles.typePill, { backgroundColor: meta.soft }]}>
                          <Text style={[styles.typePillText, { color: meta.tone }]}>{statusLabel(item)}</Text>
                        </View>
                        {item.latest_result?.need_manual_review ? (
                          <View style={styles.neutralPill}>
                            <Text style={styles.neutralPillText}>建议人工复核</Text>
                          </View>
                        ) : null}
                      </View>

                      <Text style={styles.recordDetail} numberOfLines={2}>
                        {item.latest_result?.summary ?? item.content_preview ?? "暂无文本摘要"}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
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
  listCard: {
    borderRadius: radius.lg,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    overflow: "hidden",
    ...panelShadow,
  },
  recordRow: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  rowPressed: {
    backgroundColor: palette.surfaceSoft,
  },
  rowDivider: {
    borderBottomWidth: 1,
    borderColor: palette.line,
  },
  recordIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
  },
  recordBody: {
    flex: 1,
    gap: 8,
  },
  recordTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  recordTitle: {
    flex: 1,
    color: palette.ink,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  recordTime: {
    color: palette.lineStrong,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  metaLine: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  typePill: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  typePillText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  neutralPill: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: palette.surfaceSoft,
  },
  neutralPillText: {
    color: palette.inkSoft,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  recordDetail: {
    color: palette.inkSoft,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: fontFamily.body,
  },
  buttonPressed: {
    transform: [{ scale: 0.98 }],
  },
});
