import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "@/features/auth";
import { resolveApiFileUrl } from "@/shared/api";
import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";

import { callInterventionApi } from "../api";
import { deriveCallSessionTitle, formatCallPhoneLabel } from "../presentation";
import type { CallSession, RiskLevel } from "../types";

const MAX_RETRANSCRIBE_DURATION_MS = 10 * 60 * 1000;

const riskTone: Record<RiskLevel, { tone: string; soft: string; label: string }> = {
  low: { tone: "#2F70E6", soft: "#EAF2FF", label: "低风险" },
  medium: { tone: "#FF9C48", soft: "#FFF3E5", label: "中风险" },
  high: { tone: "#E14D4D", soft: "#FFECEC", label: "高风险" },
};

const ruleLabelMap: Record<string, string> = {
  safe_account_transfer: "安全账户",
  verify_code_request: "验证码",
  remote_screen_share: "远程控制",
  authority_plus_transfer: "身份冒充",
  authority_transfer_combo: "权威身份+转账",
  audio_linear_classifier_high: "音频高风险",
  AI中风险判定: "AI中风险",
  AI高风险判定: "AI高风险",
};

function formatTime(value?: string | null) {
  if (!value) {
    return "--";
  }

  const date = new Date(value);
  const hh = date.getHours().toString().padStart(2, "0");
  const mm = date.getMinutes().toString().padStart(2, "0");
  return `${date.getMonth() + 1}-${date.getDate()} ${hh}:${mm}`;
}

function formatDuration(durationMs?: number | null) {
  const totalSeconds = Math.max(0, Math.floor((durationMs ?? 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function describeRule(ruleCode: string) {
  return ruleLabelMap[ruleCode] ?? ruleCode;
}

function retranscribeStatusLabel(status: string) {
  if (status === "retranscribed") {
    return "已重转写";
  }
  if (status === "retranscribe_failed") {
    return "已使用";
  }
  if (status === "retranscribing") {
    return "转写中";
  }
  if (status === "completed") {
    return "已完成";
  }
  if (status === "streaming") {
    return "转写中";
  }
  return "待转写";
}

export default function CallInterventionSessionDetailScreen() {
  const router = useRouter();
  const { sessionId } = useLocalSearchParams<{ sessionId?: string | string[] }>();
  const { token } = useAuth();
  const [session, setSession] = useState<CallSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [openingAudio, setOpeningAudio] = useState(false);
  const [retranscribing, setRetranscribing] = useState(false);

  const sessionIdValue = Array.isArray(sessionId) ? sessionId[0] : sessionId;

  useEffect(() => {
    let cancelled = false;

    async function loadSession() {
      if (!token || !sessionIdValue) {
        if (!cancelled) {
          setLoading(false);
        }
        return;
      }

      try {
        const detail = await callInterventionApi.getSession(sessionIdValue, token);
        if (!cancelled) {
          setSession(detail);
        }
      } catch (error) {
        if (!cancelled) {
          Alert.alert("加载失败", error instanceof Error ? error.message : "未能加载通话记录。");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadSession();

    return () => {
      cancelled = true;
    };
  }, [sessionIdValue, token]);

  const audioUrl = useMemo(() => resolveApiFileUrl(session?.audio_file_url), [session?.audio_file_url]);

  const sessionTitle = useMemo(() => (session ? deriveCallSessionTitle(session) : ""), [session]);
  const phoneLabel = useMemo(() => formatCallPhoneLabel(session?.phone_number), [session?.phone_number]);
  const canRetranscribe = Boolean(
    session &&
      audioUrl &&
      session.transcript_status !== "retranscribing" &&
      session.transcript_status !== "retranscribed" &&
      session.transcript_status !== "retranscribe_failed" &&
      ((session.audio_duration_ms ?? 0) <= 0 || (session.audio_duration_ms ?? 0) <= MAX_RETRANSCRIBE_DURATION_MS)
  );

  const openAudio = async () => {
    if (!audioUrl) {
      return;
    }

    setOpeningAudio(true);
    try {
      await WebBrowser.openBrowserAsync(audioUrl);
    } catch (error) {
      Alert.alert("打开失败", error instanceof Error ? error.message : "暂时无法打开录音。");
    } finally {
      setOpeningAudio(false);
    }
  };

  const handleRetranscribe = async () => {
    if (!token || !sessionIdValue || !session) {
      return;
    }
    if (!canRetranscribe) {
      if ((session.audio_duration_ms ?? 0) > MAX_RETRANSCRIBE_DURATION_MS) {
        Alert.alert("无法重转写", "仅支持 10 分钟内的通话录音。");
      } else {
        Alert.alert("无法重转写", "每通对话只允许重新转写一次。");
      }
      return;
    }

    setRetranscribing(true);
    try {
      const detail = await callInterventionApi.retranscribeSession(sessionIdValue, token);
      setSession(detail);
      Alert.alert("重新转写完成", "已更新转写内容。");
    } catch (error) {
      Alert.alert("重新转写失败", error instanceof Error ? error.message : "请稍后重试。");
    } finally {
      setRetranscribing(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingRoot}>
        <ActivityIndicator color={palette.accentStrong} />
      </View>
    );
  }

  if (!session) {
    return (
      <View style={styles.loadingRoot}>
        <Text style={styles.emptyText}>未找到这条通话记录。</Text>
      </View>
    );
  }

  const tone = riskTone[session.risk_level_final];

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Pressable style={({ pressed }) => [styles.backButton, pressed && styles.buttonPressed]} onPress={() => router.back()}>
            <MaterialCommunityIcons name="chevron-left" size={18} color={palette.accentStrong} />
            <Text style={styles.backText}>返回</Text>
          </Pressable>

          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>通话概览</Text>
              <View style={[styles.riskPill, { backgroundColor: tone.soft }]}>
                <Text style={[styles.riskPillText, { color: tone.tone }]}>{tone.label}</Text>
              </View>
            </View>
            <Text style={styles.sessionTitle}>{sessionTitle}</Text>
            <Text style={styles.phoneNumber}>{phoneLabel}</Text>
            <View style={styles.metaRow}>
              <Text style={styles.cardDetail}>开始 {formatTime(session.started_at)}</Text>
              <Text style={styles.cardDetail}>结束 {formatTime(session.ended_at)}</Text>
            </View>
            <Text style={styles.cardDetail}>{session.summary || "已保存录音与风险结果。"}</Text>
          </View>

          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>录音文件</Text>
              <Text style={styles.cardMeta}>{formatDuration(session.audio_duration_ms)}</Text>
            </View>
            <Text style={styles.cardDetail}>{audioUrl ? "可直接打开录音，异常时可重转写一次。" : "当前没有可用录音。"}</Text>
            <View style={styles.buttonRow}>
              {audioUrl ? (
                <Pressable
                  style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed, openingAudio && styles.buttonDisabled]}
                  onPress={() => void openAudio()}
                  disabled={openingAudio}
                >
                  <MaterialCommunityIcons name="play-circle-outline" size={18} color={palette.white} />
                  <Text style={styles.primaryButtonText}>打开录音</Text>
                </Pressable>
              ) : null}
              <Pressable
                style={({ pressed }) => [
                  styles.secondaryButton,
                  pressed && styles.buttonPressed,
                  (!canRetranscribe || retranscribing) && styles.buttonDisabled,
                ]}
                onPress={() => void handleRetranscribe()}
                disabled={!canRetranscribe || retranscribing}
              >
                <MaterialCommunityIcons name="refresh" size={16} color={palette.accentStrong} />
                <Text style={styles.secondaryButtonText}>{retranscribing ? "重新转写中" : "重新转写"}</Text>
              </Pressable>
            </View>
            <Text style={styles.statusText}>
              {retranscribeStatusLabel(session.transcript_status)} · 限 1 次 · 10 分钟内
            </Text>
          </View>

          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>风险事件</Text>
              <Text style={styles.cardMeta}>{session.risk_events.length} 条</Text>
            </View>
            {session.risk_events.length === 0 ? (
              <Text style={styles.emptyText}>本次通话未新增命中规则。</Text>
            ) : (
              <View style={styles.list}>
                {session.risk_events.map((item) => {
                  const itemTone = riskTone[item.risk_level];
                  return (
                    <View key={item.id} style={[styles.riskRow, { backgroundColor: itemTone.soft }]}>
                      <Text style={[styles.riskRowTitle, { color: itemTone.tone }]}>{describeRule(item.matched_rule)}</Text>
                      <Text style={styles.riskRowText}>{item.message}</Text>
                      <Text style={styles.cardMeta}>{formatTime(item.created_at)}</Text>
                    </View>
                  );
                })}
              </View>
            )}
          </View>

          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>转写回看</Text>
              <Text style={styles.cardMeta}>{session.segments.length} 段</Text>
            </View>
            {session.segments.length === 0 ? (
              <Text style={styles.emptyText}>当前没有转写内容。</Text>
            ) : (
              <View style={styles.list}>
                {session.segments.map((item) => (
                  <View key={item.id} style={styles.segmentRow}>
                    <Text style={styles.segmentTime}>
                      {Math.floor(item.start_ms / 1000)}s - {Math.floor(item.end_ms / 1000)}s
                    </Text>
                    <Text style={styles.segmentText}>{item.text}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
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
  loadingRoot: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.background,
    gap: 10,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 28,
    gap: 14,
  },
  backButton: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: radius.pill,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
  },
  backText: {
    color: palette.accentStrong,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  card: {
    borderRadius: radius.lg,
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    gap: 12,
    ...panelShadow,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  cardTitle: {
    color: palette.ink,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  cardMeta: {
    color: palette.lineStrong,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fontFamily.body,
  },
  cardDetail: {
    color: palette.inkSoft,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: fontFamily.body,
  },
  sessionTitle: {
    color: palette.ink,
    fontSize: 22,
    lineHeight: 30,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  phoneNumber: {
    color: palette.lineStrong,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  riskPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  riskPillText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  buttonRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  primaryButton: {
    minHeight: 46,
    borderRadius: radius.pill,
    backgroundColor: palette.accentStrong,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
  },
  primaryButtonText: {
    color: palette.white,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  secondaryButton: {
    minHeight: 46,
    borderRadius: radius.pill,
    backgroundColor: palette.surfaceSoft,
    borderWidth: 1,
    borderColor: palette.line,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
  },
  secondaryButtonText: {
    color: palette.accentStrong,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  statusText: {
    color: palette.lineStrong,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fontFamily.body,
  },
  list: {
    gap: 10,
  },
  riskRow: {
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 4,
  },
  riskRowTitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  riskRowText: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  segmentRow: {
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: palette.surfaceSoft,
    borderWidth: 1,
    borderColor: palette.line,
    gap: 4,
  },
  segmentTime: {
    color: palette.lineStrong,
    fontSize: 11,
    lineHeight: 14,
    fontFamily: fontFamily.body,
  },
  segmentText: {
    color: palette.ink,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: fontFamily.body,
  },
  emptyText: {
    color: palette.inkSoft,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: fontFamily.body,
  },
  buttonPressed: {
    opacity: 0.92,
  },
  buttonDisabled: {
    opacity: 0.56,
  },
});
