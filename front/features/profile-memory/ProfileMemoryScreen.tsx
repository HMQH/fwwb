import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { roleMeta, useAuth } from "@/features/auth";
import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";

import { profileMemoryApi } from "./api";
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
  if (source === "assistant") {
    return "助手";
  }
  if (source === "detection") {
    return "检测";
  }
  return "画像";
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

function getTimelineStatus(item: ProfileMemoryHistoryItem) {
  const promoted = item.snapshot?.promoted_now || item.snapshot?.promoted;
  if (promoted) {
    return {
      label: "已归纳",
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

function buildHistorySummary(item: ProfileMemoryHistoryItem) {
  return (
    item.snapshot?.merged_profile_summary?.trim() ||
    item.snapshot?.candidate_memory?.trim() ||
    item.summary?.trim() ||
    "暂无"
  );
}

export default function ProfileMemoryScreen() {
  const router = useRouter();
  const { width: windowWidth } = useWindowDimensions();
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
    }, [load]),
  );

  const role = user ? roleMeta[user.role] : null;
  const safetyScore = clampScore(user?.safety_score, 95);
  const safetyMeta = getSafetyMeta(safetyScore);
  const history = document?.history ?? [];
  const latestItem = history[0] ?? null;
  const latestSummary =
    latestItem?.snapshot?.merged_profile_summary?.trim() ||
    latestItem?.snapshot?.candidate_memory?.trim() ||
    user?.profile_summary?.trim() ||
    role?.detail ||
    "暂无";

  const recentItems = useMemo(() => history.slice(0, 5), [history]);
  /** 内容区与卡片左右各 16，卡片之间留缝以便露出下一张边缘 */
  const timelineCardWidth = useMemo(
    () => Math.max(260, Math.round(windowWidth - 32 - 32 - 28)),
    [windowWidth],
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
            <Pressable
              style={({ pressed }) => [styles.iconButton, pressed && styles.buttonPressed]}
              onPress={() => router.replace("/profile")}
            >
              <MaterialCommunityIcons name="chevron-left" size={20} color={palette.accentStrong} />
            </Pressable>

            <View style={styles.titleBlock}>
              <Text style={styles.pageTitle}>个人画像</Text>
              <Text style={styles.pageSubtitle}>{user.display_name}</Text>
            </View>
          </View>

          <View style={styles.heroCard}>
            <View style={styles.heroHead}>
              <View>
                <Text style={styles.heroLabel}>当前人群</Text>
                <Text style={styles.heroTitle}>{role.label}</Text>
              </View>
              <View style={[styles.statusPill, { backgroundColor: safetyMeta.soft }]}>
                <MaterialCommunityIcons name={safetyMeta.icon} size={14} color={safetyMeta.accent} />
                <Text style={[styles.statusPillText, { color: safetyMeta.text }]}>{safetyMeta.label}</Text>
              </View>
            </View>

            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>画像摘要</Text>
              <Text style={styles.sectionMeta}>{formatDateTime(document?.updated_at)}</Text>
            </View>
            <View style={styles.summaryWithImageRow}>
              <View style={styles.summaryTextColumn}>
                <Text style={styles.summaryText}>{latestSummary}</Text>
              </View>
              <View style={[styles.heroImageCard, { backgroundColor: role.soft }]}>
                <Image source={role.image} style={styles.heroImage} resizeMode="cover" />
              </View>
            </View>

            <View style={styles.metricRow}>
              <View style={[styles.metricCard, { backgroundColor: safetyMeta.soft }]}>
                <Text style={styles.metricLabel}>安全值</Text>
                <Text style={[styles.metricValue, { color: safetyMeta.accent }]}>{safetyScore}</Text>
                <View style={[styles.progressTrack, { backgroundColor: safetyMeta.track }]}>
                  <View style={[styles.progressFill, { width: `${safetyScore}%`, backgroundColor: safetyMeta.accent }]} />
                </View>
              </View>
            </View>
          </View>

          <View style={styles.sectionCard}>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>近期归纳</Text>
              <Text style={styles.sectionMeta}>{history.length}</Text>
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
            ) : recentItems.length ? (
              <ScrollView
                horizontal
                nestedScrollEnabled
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.timelineCarouselContent}
              >
                {recentItems.map((item) => {
                  const status = getTimelineStatus(item);
                  const summary = buildHistorySummary(item);

                  return (
                    <View key={item.id} style={[styles.timelineCard, { width: timelineCardWidth }]}>
                      <View style={styles.timelineHead}>
                        <View style={styles.timelineMeta}>
                          <Text style={styles.timelineTitle}>
                            {item.snapshot?.event_title?.trim() || item.summary?.trim() || "本次归纳"}
                          </Text>
                          <Text style={styles.timelineTime}>
                            {formatDateTime(item.created_at)} · {formatSourceLabel(item.source)}
                          </Text>
                        </View>

                        <View style={[styles.timelinePill, { backgroundColor: status.soft }]}>
                          <Text style={[styles.timelinePillText, { color: status.text }]}>{status.label}</Text>
                        </View>
                      </View>

                      <Text style={styles.timelineSummary}>{summary}</Text>

                      {item.snapshot?.relation_name ? (
                        <View style={styles.timelineFooter}>
                          <MaterialCommunityIcons name="account-outline" size={14} color={palette.lineStrong} />
                          <Text style={styles.timelineHint}>{item.snapshot.relation_name}</Text>
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </ScrollView>
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
    gap: 16,
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
    fontSize: 22,
    lineHeight: 28,
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
  summaryWithImageRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  summaryTextColumn: {
    flex: 1,
    minWidth: 0,
  },
  heroImageCard: {
    width: 108,
    borderRadius: 18,
    overflow: "hidden",
    flexShrink: 0,
  },
  heroImage: {
    width: "100%",
    height: 140,
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
  summaryText: {
    color: palette.ink,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "700",
    fontFamily: fontFamily.body,
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
  stateCard: {
    minHeight: 104,
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
  timelineCarouselContent: {
    flexDirection: "row",
    alignItems: "stretch",
    paddingRight: 6,
  },
  timelineCard: {
    marginRight: 10,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 14,
    backgroundColor: palette.surfaceSoft,
    borderWidth: 1,
    borderColor: palette.line,
    gap: 10,
  },
  timelineHead: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
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
  timelineSummary: {
    color: palette.ink,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: fontFamily.body,
  },
  timelineFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  timelineHint: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  buttonPressed: { opacity: 0.9 },
});
