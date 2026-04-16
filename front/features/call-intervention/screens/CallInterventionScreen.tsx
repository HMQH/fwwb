import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useMemo } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";

import { deriveCallSessionTitle, formatCallPhoneLabel } from "../presentation";
import { useCallIntervention } from "../CallInterventionProvider";
import type { CallSession, RiskLevel } from "../types";

const riskTone: Record<
  RiskLevel,
  { tone: string; soft: string; label: string; icon: keyof typeof MaterialCommunityIcons.glyphMap }
> = {
  low: { tone: "#2F70E6", soft: "#EAF2FF", label: "低风险", icon: "shield-check-outline" },
  medium: { tone: "#FF9C48", soft: "#FFF3E5", label: "中风险", icon: "alert-outline" },
  high: { tone: "#E14D4D", soft: "#FFECEC", label: "高风险", icon: "shield-alert-outline" },
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

function formatDuration(durationMs?: number | null) {
  const totalSeconds = Math.max(0, Math.floor((durationMs ?? 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function formatSessionTime(value: string) {
  const date = new Date(value);
  const hh = date.getHours().toString().padStart(2, "0");
  const mm = date.getMinutes().toString().padStart(2, "0");
  return `${date.getMonth() + 1}-${date.getDate()} ${hh}:${mm}`;
}

function describeRule(ruleCode: string) {
  return ruleLabelMap[ruleCode] ?? ruleCode;
}

function SessionCard({ item, onPress }: { item: CallSession; onPress: () => void }) {
  const tone = riskTone[item.risk_level_final];
  const title = deriveCallSessionTitle(item);

  return (
    <Pressable style={({ pressed }) => [styles.sessionCard, pressed && styles.buttonPressed]} onPress={onPress}>
      <View style={styles.sessionTopRow}>
        <View style={[styles.riskPill, { backgroundColor: tone.soft }]}>
          <Text style={[styles.riskPillText, { color: tone.tone }]}>{tone.label}</Text>
        </View>
        <Text style={styles.sessionTime}>{formatSessionTime(item.started_at)}</Text>
      </View>
      <Text style={styles.sessionTitle} numberOfLines={2}>
        {title}
      </Text>
      <Text style={styles.sessionPhone} numberOfLines={1}>
        {formatCallPhoneLabel(item.phone_number)}
      </Text>
      <View style={styles.sessionBottomRow}>
        <View style={styles.sessionMetaChip}>
          <MaterialCommunityIcons name="waveform" size={14} color={palette.accentStrong} />
          <Text style={styles.sessionMetaText}>{formatDuration(item.audio_duration_ms)}</Text>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={18} color={palette.lineStrong} />
      </View>
    </Pressable>
  );
}

export default function CallInterventionScreen() {
  const router = useRouter();
  const {
    incomingRisk,
    recording,
    liveTranscriptPreview,
    transcriptSegments,
    liveRiskEvents,
    sessionHistory,
    isBusy,
    refreshHistory,
    refreshNativeDetectionStatus,
    startManualRecording,
    stopManualRecording,
    resetDashboardState,
  } = useCallIntervention();

  const currentRiskLevel = incomingRisk?.riskLevel ?? recording.riskLevel ?? "low";
  const currentTone = riskTone[currentRiskLevel];
  const currentPhoneNumber = formatCallPhoneLabel(incomingRisk?.phoneNumber ?? recording.phoneNumber);
  const liveText = useMemo(() => {
    if (liveTranscriptPreview.trim()) {
      return liveTranscriptPreview.trim();
    }
    return transcriptSegments.slice(-1)[0]?.text?.trim() ?? "";
  }, [liveTranscriptPreview, transcriptSegments]);
  const latestRiskRows = useMemo(() => liveRiskEvents.slice(-4).reverse(), [liveRiskEvents]);
  const latestRiskMessage =
    latestRiskRows[0]?.message ??
    incomingRisk?.message ??
    (recording.isRecording ? "正在监听通话内容" : "开启录音后开始实时分析");

  const handleRefresh = async () => {
    resetDashboardState();
    await refreshNativeDetectionStatus();
    await refreshHistory();
  };

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.topBar}>
            <Pressable style={({ pressed }) => [styles.backButton, pressed && styles.buttonPressed]} onPress={() => router.back()}>
              <MaterialCommunityIcons name="chevron-left" size={18} color={palette.accentStrong} />
              <Text style={styles.backText}>返回</Text>
            </Pressable>
            <View style={styles.topActions}>
              <Pressable
                style={({ pressed }) => [styles.ghostButton, pressed && styles.buttonPressed]}
                onPress={() => router.push("/settings" as never)}
              >
                <MaterialCommunityIcons name="cog-outline" size={16} color={palette.accentStrong} />
                <Text style={styles.ghostText}>权限</Text>
              </Pressable>
              <Pressable style={({ pressed }) => [styles.ghostButton, pressed && styles.buttonPressed]} onPress={() => void handleRefresh()}>
                <MaterialCommunityIcons name="refresh" size={16} color={palette.accentStrong} />
                <Text style={styles.ghostText}>刷新</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.mainCard}>
            <View style={styles.mainHeader}>
              <View>
                <Text style={styles.mainTitle}>实时转写与风险</Text>
                <Text style={styles.mainSubTitle}>{currentPhoneNumber}</Text>
              </View>
              <View style={styles.mainHeaderRight}>
                <View style={[styles.riskPill, { backgroundColor: currentTone.soft }]}>
                  <MaterialCommunityIcons name={currentTone.icon} size={14} color={currentTone.tone} />
                  <Text style={[styles.riskPillText, { color: currentTone.tone }]}>{currentTone.label}</Text>
                </View>
                <Text style={[styles.timerText, recording.isRecording && styles.timerTextActive]}>
                  {recording.isRecording ? `录音中 ${formatDuration(recording.durationMs)}` : "未开始"}
                </Text>
              </View>
            </View>

            <View style={styles.signalPanel}>
              <Text style={styles.signalTitle}>风险提示</Text>
              <Text style={styles.signalMessage}>{latestRiskMessage}</Text>
              {latestRiskRows.length === 0 ? (
                <Text style={styles.signalEmpty}>开始录音后在这里追加</Text>
              ) : (
                <View style={styles.signalList}>
                  {latestRiskRows.map((item) => {
                    const tone = riskTone[item.risk_level];
                    return (
                      <View key={item.id} style={[styles.signalRow, { backgroundColor: tone.soft }]}>
                        <MaterialCommunityIcons name="alert-circle-outline" size={16} color={tone.tone} />
                        <View style={styles.signalBody}>
                          <Text style={[styles.signalRowTitle, { color: tone.tone }]}>{describeRule(item.matched_rule)}</Text>
                          <Text style={styles.signalRowText}>{item.message}</Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>

            <View style={styles.transcriptPanel}>
              <View style={styles.transcriptHeader}>
                <Text style={styles.transcriptTitle}>实时转写</Text>
                <Text style={styles.transcriptMeta}>{transcriptSegments.length} 段</Text>
              </View>
              <Text style={styles.transcriptText}>{liveText || "录音开始后，这里显示最新一句转写。"}</Text>
            </View>

            <Pressable
              style={({ pressed }) => [
                styles.recordButton,
                recording.isRecording ? styles.recordButtonStop : styles.recordButtonStart,
                pressed && styles.buttonPressed,
                isBusy && styles.buttonDisabled,
              ]}
              onPress={() => {
                if (recording.isRecording) {
                  void stopManualRecording();
                  return;
                }
                void startManualRecording({ phoneNumber: incomingRisk?.phoneNumber ?? recording.phoneNumber, callDirection: "incoming" });
              }}
              disabled={isBusy}
            >
              <MaterialCommunityIcons
                name={recording.isRecording ? "stop-circle-outline" : "record-rec"}
                size={18}
                color={palette.white}
              />
              <Text style={styles.recordButtonText}>{recording.isRecording ? "结束录音并保存" : "开启免提录音"}</Text>
            </Pressable>
          </View>

          <View style={styles.historyCard}>
            <View style={styles.historyHeader}>
              <Text style={styles.historyTitle}>通话后回看</Text>
              <Text style={styles.historyMeta}>{sessionHistory.length} 条</Text>
            </View>
            {sessionHistory.length === 0 ? (
              <Text style={styles.historyEmpty}>结束录音后保存在这里</Text>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.historyRail}
                decelerationRate="fast"
                snapToAlignment="start"
              >
                {sessionHistory.map((item) => (
                  <SessionCard
                    key={item.id}
                    item={item}
                    onPress={() => router.push(`/call-intervention/${item.id}` as never)}
                  />
                ))}
              </ScrollView>
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
  content: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 28,
    gap: 14,
  },
  topBar: {
    gap: 10,
  },
  topActions: {
    flexDirection: "row",
    gap: 10,
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
  ghostButton: {
    flex: 1,
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
  },
  ghostText: {
    color: palette.accentStrong,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  mainCard: {
    borderRadius: radius.lg,
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    gap: 14,
    ...panelShadow,
  },
  mainHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  mainHeaderRight: {
    alignItems: "flex-end",
    gap: 8,
  },
  mainTitle: {
    color: palette.ink,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  mainSubTitle: {
    marginTop: 4,
    color: palette.lineStrong,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  riskPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
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
  timerText: {
    color: palette.lineStrong,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  timerTextActive: {
    color: "#D45555",
  },
  signalPanel: {
    borderRadius: radius.md,
    backgroundColor: palette.surfaceSoft,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 10,
  },
  signalTitle: {
    color: palette.ink,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  signalMessage: {
    color: palette.ink,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  signalEmpty: {
    color: palette.lineStrong,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  signalList: {
    gap: 8,
  },
  signalRow: {
    flexDirection: "row",
    gap: 10,
    borderRadius: radius.md,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  signalBody: {
    flex: 1,
    gap: 2,
  },
  signalRowTitle: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  signalRowText: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  transcriptPanel: {
    borderRadius: radius.md,
    backgroundColor: "#FFF9F4",
    borderWidth: 1,
    borderColor: "#F4D7BD",
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 8,
  },
  transcriptHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },
  transcriptTitle: {
    color: palette.ink,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  transcriptMeta: {
    color: palette.lineStrong,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fontFamily.body,
  },
  transcriptText: {
    color: palette.ink,
    fontSize: 14,
    lineHeight: 22,
    fontFamily: fontFamily.body,
  },
  recordButton: {
    minHeight: 48,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  recordButtonStart: {
    backgroundColor: "#2D8C5B",
  },
  recordButtonStop: {
    backgroundColor: "#D45555",
  },
  recordButtonText: {
    color: palette.white,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  historyCard: {
    borderRadius: radius.lg,
    paddingVertical: 16,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    gap: 12,
    ...panelShadow,
  },
  historyHeader: {
    paddingHorizontal: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  historyTitle: {
    color: palette.ink,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  historyMeta: {
    color: palette.lineStrong,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fontFamily.body,
  },
  historyEmpty: {
    paddingHorizontal: 16,
    color: palette.inkSoft,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: fontFamily.body,
  },
  historyRail: {
    paddingHorizontal: 16,
    gap: 12,
  },
  sessionCard: {
    width: 276,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 14,
    backgroundColor: palette.surfaceSoft,
    borderWidth: 1,
    borderColor: palette.line,
    gap: 12,
  },
  sessionTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },
  sessionTime: {
    color: palette.lineStrong,
    fontSize: 11,
    lineHeight: 14,
    fontFamily: fontFamily.body,
  },
  sessionTitle: {
    color: palette.ink,
    fontSize: 17,
    lineHeight: 24,
    fontWeight: "900",
    fontFamily: fontFamily.display,
    minHeight: 48,
  },
  sessionPhone: {
    color: palette.inkSoft,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  sessionBottomRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sessionMetaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: palette.surface,
  },
  sessionMetaText: {
    color: palette.accentStrong,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  buttonPressed: {
    opacity: 0.92,
  },
  buttonDisabled: {
    opacity: 0.56,
  },
});
