import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { roleMeta, useAuth } from "@/features/auth";
import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";

import { profileMemoryApi } from "./api";
import { MemoryMarkdown } from "./MemoryMarkdown";
import type { ProfileMemoryDocument, ProfileMemoryHistoryItem } from "./types";

function clampScore(value: number | null | undefined, fallback: number) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.min(100, Math.round(Number(value))));
}

function formatDateTime(value?: string | null) {
  if (!value) {
    return "暂无";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const hour = `${date.getHours()}`.padStart(2, "0");
  const minute = `${date.getMinutes()}`.padStart(2, "0");
  return `${month}-${day} ${hour}:${minute}`;
}

function formatSourceLabel(source: string) {
  return source === "assistant" ? "助手" : source === "detection" ? "检测" : "记忆";
}

function getSafetyMeta(score: number) {
  if (score >= 92) {
    return {
      label: "稳定",
      icon: "shield-check" as const,
      accent: "#2F70E6",
      soft: "#EAF2FF",
      track: "#C7DBFF",
      text: "#1E5CC7",
    };
  }

  if (score >= 76) {
    return {
      label: "留意",
      icon: "shield-alert-outline" as const,
      accent: "#D68A1F",
      soft: "#FFF2DF",
      track: "#F3D19D",
      text: "#B66D05",
    };
  }

  return {
    label: "高警惕",
    icon: "shield-off-outline" as const,
    accent: "#D85E6A",
    soft: "#FFE6EA",
    track: "#F1B4BC",
    text: "#C34653",
  };
}

function getUrgencyMeta(score: number) {
  if (score >= 70) {
    return {
      label: "待沉淀",
      icon: "lightning-bolt-circle" as const,
      accent: "#D85E6A",
      soft: "#FFE6EA",
      track: "#F3BAC2",
      text: "#C34653",
    };
  }

  if (score >= 36) {
    return {
      label: "积累中",
      icon: "progress-clock" as const,
      accent: "#D68A1F",
      soft: "#FFF2DF",
      track: "#F3D19D",
      text: "#B66D05",
    };
  }

  return {
    label: "低",
    icon: "timer-sand-empty" as const,
    accent: "#2F70E6",
    soft: "#EAF2FF",
    track: "#C7DBFF",
    text: "#1E5CC7",
  };
}

function getTimelineStatus(item: ProfileMemoryHistoryItem) {
  const promoted = item.snapshot?.promoted_now || item.snapshot?.promoted;
  if (promoted) {
    return {
      label: "已入长期",
      soft: "#EAF2FF",
      text: "#1E5CC7",
    };
  }

  return {
    label: "待观察",
    soft: "#FFF2DF",
    text: "#B66D05",
  };
}

export default function ProfileMemoryScreen() {
  const router = useRouter();
  const { user, token, refreshCurrentUser } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [document, setDocument] = useState<ProfileMemoryDocument | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await refreshCurrentUser();
      const payload = await profileMemoryApi.get(token);
      setDocument(payload);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [refreshCurrentUser, token]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const role = user ? roleMeta[user.role] : null;
  const safetyScore = clampScore(user?.safety_score, 95);
  const urgencyScore = clampScore(user?.memory_urgency_score, 0);
  const safetyMeta = getSafetyMeta(safetyScore);
  const urgencyMeta = getUrgencyMeta(urgencyScore);
  const history = document?.history ?? [];
  const historyCount = history.length;
  const latestMemory = useMemo(
    () =>
      history.find((item) => item.snapshot?.candidate_memory || item.snapshot?.merged_profile_summary)?.snapshot
        ?.candidate_memory ??
      history.find((item) => item.snapshot?.merged_profile_summary)?.snapshot?.merged_profile_summary ??
      null,
    [history]
  );

  if (!user || !role || !token) {
    return null;
  }

  return (
    <View style={styles.root}>
      <View style={styles.backgroundOrbTop} />
      <View style={styles.backgroundOrbBottom} />

      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.topBar}>
            <Pressable style={({ pressed }) => [styles.iconButton, pressed && styles.buttonPressed]} onPress={() => router.back()}>
              <MaterialCommunityIcons name="chevron-left" size={20} color={palette.accentStrong} />
            </Pressable>

            <View style={styles.titleBlock}>
              <Text style={styles.pageTitle}>用户画像</Text>
              <Text style={styles.pageSubtitle}>{user.display_name}</Text>
            </View>
          </View>

          <View style={styles.heroCard}>
            <View style={styles.heroHead}>
              <View>
                <Text style={styles.heroLabel}>长期画像</Text>
                <Text style={styles.heroTitle}>{role.label}</Text>
              </View>
              <View style={[styles.statusPill, { backgroundColor: safetyMeta.soft }]}>
                <MaterialCommunityIcons name={safetyMeta.icon} size={14} color={safetyMeta.accent} />
                <Text style={[styles.statusPillText, { color: safetyMeta.text }]}>{safetyMeta.label}</Text>
              </View>
            </View>

            <Text style={styles.heroSummary}>{user.profile_summary?.trim() || "系统待积累"}</Text>

            <View style={styles.metricRow}>
              <View style={[styles.metricCard, { backgroundColor: safetyMeta.soft }]}>
                <Text style={styles.metricLabel}>安全值</Text>
                <Text style={[styles.metricValue, { color: safetyMeta.accent }]}>{safetyScore}</Text>
                <View style={[styles.progressTrack, { backgroundColor: safetyMeta.track }]}>
                  <View style={[styles.progressFill, { width: `${safetyScore}%`, backgroundColor: safetyMeta.accent }]} />
                </View>
              </View>

              <View style={[styles.metricCard, { backgroundColor: urgencyMeta.soft }]}>
                <Text style={styles.metricLabel}>紧迫值</Text>
                <Text style={[styles.metricValue, { color: urgencyMeta.accent }]}>{urgencyScore}</Text>
                <View style={[styles.progressTrack, { backgroundColor: urgencyMeta.track }]}>
                  <View style={[styles.progressFill, { width: `${urgencyScore}%`, backgroundColor: urgencyMeta.accent }]} />
                </View>
              </View>
            </View>

            <View style={styles.summaryGrid}>
              <View style={styles.summaryCard}>
                <Text style={styles.summaryLabel}>角色焦点</Text>
                <Text style={styles.summaryText}>{role.tone}</Text>
              </View>
              <View style={styles.summaryCard}>
                <Text style={styles.summaryLabel}>记忆文件</Text>
                <Text style={styles.summaryText}>{document?.path || "待生成"}</Text>
              </View>
            </View>
          </View>

          <View style={styles.sectionCard}>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>MEMORY.md</Text>
              <Text style={styles.sectionMeta}>{document?.updated_at ? formatDateTime(document.updated_at) : "未生成"}</Text>
            </View>

            {loading ? (
              <View style={styles.stateCard}>
                <ActivityIndicator size="small" color={palette.accentStrong} />
                <Text style={styles.stateText}>加载中</Text>
              </View>
            ) : error ? (
              <View style={styles.stateCard}>
                <Text style={styles.stateText}>{error}</Text>
              </View>
            ) : document?.markdown ? (
              <View style={styles.markdownCard}>
                <MemoryMarkdown markdown={document.markdown} />
              </View>
            ) : (
              <View style={styles.stateCard}>
                <Text style={styles.stateText}>暂无</Text>
              </View>
            )}
          </View>

          <View style={styles.sectionCard}>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>最新归纳</Text>
              {latestMemory ? <Text style={styles.sectionMeta}>已生成</Text> : null}
            </View>
            <Text style={styles.latestMemory}>{latestMemory || "暂无"}</Text>
          </View>

          <View style={styles.sectionCard}>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>归纳记录</Text>
              <Text style={styles.sectionMeta}>{historyCount}</Text>
            </View>

            {loading ? (
              <View style={styles.stateCard}>
                <ActivityIndicator size="small" color={palette.accentStrong} />
                <Text style={styles.stateText}>加载中</Text>
              </View>
            ) : error ? (
              <View style={styles.stateCard}>
                <Text style={styles.stateText}>{error}</Text>
              </View>
            ) : history.length ? (
              <View style={styles.timeline}>
                {history.map((item) => {
                  const snapshot = item.snapshot;
                  const status = getTimelineStatus(item);
                  return (
                    <View key={item.id} style={styles.timelineCard}>
                      <View style={styles.timelineHead}>
                        <View style={styles.timelineMeta}>
                          <Text style={styles.timelineTitle}>
                            {snapshot?.candidate_memory || snapshot?.merged_profile_summary || snapshot?.event_title || "本次归纳"}
                          </Text>
                          <Text style={styles.timelineTime}>
                            {formatDateTime(item.created_at)} · {formatSourceLabel(item.source)}
                          </Text>
                        </View>

                        <View style={[styles.timelinePill, { backgroundColor: status.soft }]}>
                          <Text style={[styles.timelinePillText, { color: status.text }]}>{status.label}</Text>
                        </View>
                      </View>

                      <View style={styles.signalRow}>
                        <View style={styles.signalItem}>
                          <Text style={styles.signalItemLabel}>来源</Text>
                          <Text style={styles.signalItemValue}>{formatSourceLabel(item.source)}</Text>
                        </View>
                        <View style={styles.signalItem}>
                          <Text style={styles.signalItemLabel}>晋升分</Text>
                          <Text style={styles.signalItemValue}>
                            {Number.isFinite(snapshot?.promotion_score) ? Number(snapshot?.promotion_score).toFixed(2) : "—"}
                          </Text>
                        </View>
                        <View style={styles.signalItem}>
                          <Text style={styles.signalItemLabel}>紧迫</Text>
                          <Text style={styles.signalItemValue}>{snapshot?.urgency_score_after ?? 0}</Text>
                        </View>
                      </View>

                      {!!snapshot?.relation_name && <Text style={styles.timelineHint}>对象：{snapshot.relation_name}</Text>}
                      {!!snapshot?.promotion_reason && <Text style={styles.timelineHint}>{snapshot.promotion_reason}</Text>}
                      {!!snapshot?.merge_reason && <Text style={styles.timelineHint}>{snapshot.merge_reason}</Text>}
                    </View>
                  );
                })}
              </View>
            ) : (
              <View style={styles.stateCard}>
                <Text style={styles.stateText}>暂无</Text>
              </View>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.background },
  safeArea: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 24, gap: 16 },
  backgroundOrbTop: {
    position: "absolute",
    top: -110,
    right: -40,
    width: 240,
    height: 240,
    borderRadius: 999,
    backgroundColor: "rgba(117, 167, 255, 0.14)",
  },
  backgroundOrbBottom: {
    position: "absolute",
    left: -72,
    bottom: 80,
    width: 220,
    height: 220,
    borderRadius: 999,
    backgroundColor: "rgba(196, 218, 255, 0.2)",
  },
  topBar: { flexDirection: "row", alignItems: "center", gap: 12 },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    alignItems: "center",
    justifyContent: "center",
  },
  titleBlock: { flex: 1, gap: 2 },
  pageTitle: {
    color: palette.ink,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  pageSubtitle: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fontFamily.body,
  },
  heroCard: {
    borderRadius: radius.xl,
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    gap: 14,
    ...panelShadow,
  },
  heroHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  heroLabel: {
    color: palette.inkSoft,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  heroTitle: {
    color: palette.ink,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  statusPill: {
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  statusPillText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  heroSummary: {
    color: palette.ink,
    fontSize: 18,
    lineHeight: 28,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  metricRow: { flexDirection: "row", gap: 10 },
  metricCard: {
    flex: 1,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 10,
  },
  metricLabel: {
    color: palette.inkSoft,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  metricValue: {
    fontSize: 34,
    lineHeight: 38,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  progressTrack: {
    width: "100%",
    height: 8,
    borderRadius: radius.pill,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: radius.pill,
  },
  summaryGrid: { flexDirection: "row", gap: 10 },
  summaryCard: {
    flex: 1,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 14,
    backgroundColor: palette.surfaceSoft,
    borderWidth: 1,
    borderColor: palette.line,
    gap: 8,
  },
  summaryLabel: {
    color: palette.inkSoft,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  summaryText: {
    color: palette.ink,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  sectionCard: {
    borderRadius: radius.xl,
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    gap: 14,
    ...panelShadow,
  },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  sectionTitle: {
    color: palette.ink,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  sectionMeta: {
    color: palette.accentStrong,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  markdownCard: {
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 14,
    backgroundColor: palette.background,
    borderWidth: 1,
    borderColor: palette.line,
  },
  latestMemory: {
    color: palette.ink,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  stateCard: {
    minHeight: 96,
    borderRadius: radius.lg,
    backgroundColor: palette.surfaceSoft,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  stateText: {
    color: palette.inkSoft,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  timeline: { gap: 10 },
  timelineCard: {
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 14,
    backgroundColor: palette.surfaceSoft,
    borderWidth: 1,
    borderColor: palette.line,
    gap: 10,
  },
  timelineHead: { flexDirection: "row", gap: 10, alignItems: "flex-start", justifyContent: "space-between" },
  timelineMeta: { flex: 1, gap: 4 },
  timelineTitle: {
    color: palette.ink,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  timelineTime: {
    color: palette.inkSoft,
    fontSize: 11,
    lineHeight: 14,
    fontFamily: fontFamily.body,
  },
  timelinePill: {
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  timelinePillText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  signalRow: { flexDirection: "row", gap: 8 },
  signalItem: {
    flex: 1,
    borderRadius: radius.md,
    paddingHorizontal: 10,
    paddingVertical: 10,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    gap: 4,
  },
  signalItemLabel: {
    color: palette.inkSoft,
    fontSize: 10,
    lineHeight: 12,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  signalItemValue: {
    color: palette.ink,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  timelineHint: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  buttonPressed: { opacity: 0.9 },
});
