import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { useCallback, useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { fontFamily, palette, radius } from "@/shared/theme";
import { TaskPrimaryButton, TaskScreen } from "@/shared/ui/TaskScreen";

import { useCallIntervention } from "../CallInterventionProvider";
import { deriveCallSessionTitle, formatCallPhoneLabel } from "../presentation";
import type { RiskLevel } from "../types";

function formatDuration(durationMs?: number | null) {
  const totalSeconds = Math.max(0, Math.floor((durationMs ?? 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}`;
}

function formatTime(value?: string | null) {
  if (!value) {
    return "--";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return `${date.getMonth() + 1}/${date.getDate()} ${date
    .getHours()
    .toString()
    .padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
}

function riskTone(level: RiskLevel) {
  if (level === "high") {
    return { tint: "#D9485F", soft: "#FFF0F0", label: "高风险" };
  }
  if (level === "medium") {
    return { tint: "#D68910", soft: "#FFF7E8", label: "中风险" };
  }
  return { tint: "#2F70E6", soft: "#EAF2FF", label: "低风险" };
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
    startManualRecording,
    stopManualRecording,
    nativeDetectionStatus,
    refreshHistory,
  } = useCallIntervention();

  useFocusEffect(
    useCallback(() => {
      void refreshHistory();
    }, [refreshHistory]),
  );

  const liveText = useMemo(() => {
    if (liveTranscriptPreview.trim()) {
      return liveTranscriptPreview.trim();
    }
    return transcriptSegments.slice(-1)[0]?.text?.trim() ?? "";
  }, [liveTranscriptPreview, transcriptSegments]);

  const latestRisk = liveRiskEvents.slice(-1)[0];
  const currentRiskLevel =
    incomingRisk?.riskLevel === "high" || recording.riskLevel === "high"
      ? "high"
      : incomingRisk?.riskLevel === "medium" || recording.riskLevel === "medium"
        ? "medium"
        : "low";
  const currentTone = riskTone(currentRiskLevel);
  const recentSessions = sessionHistory.slice(0, 3);

  return (
    <TaskScreen
      title="通话实时检测"
      footer={
        <TaskPrimaryButton
          label={
            recording.isRecording
              ? `停止检测 ${formatDuration(recording.durationMs)}`
              : "开始检测"
          }
          onPress={() => {
            if (recording.isRecording) {
              void stopManualRecording();
              return;
            }
            void startManualRecording({ callDirection: "incoming" });
          }}
          loading={isBusy}
        />
      }
    >
      <View style={styles.content}>
        <View style={styles.headRow}>
          <View style={[styles.iconWrap, { backgroundColor: "#EAF8F1" }]}>
            <MaterialCommunityIcons
              name="phone-in-talk-outline"
              size={22}
              color="#22A06B"
            />
          </View>
          <View style={styles.headCopy}>
            <Text style={styles.headTitle}>通话实时检测</Text>
            <Text style={styles.headMeta}>
              {recording.isRecording ? "检测中" : "待开始"}
            </Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: currentTone.soft }]}>
            <Text style={[styles.statusBadgeText, { color: currentTone.tint }]}>
              {currentTone.label}
            </Text>
          </View>
        </View>

        <View style={styles.statusGrid}>
          <View style={styles.statusCard}>
            <Text style={styles.statusLabel}>来电识别</Text>
            <Text style={styles.statusValue}>
              {nativeDetectionStatus.callScreeningEnabled ? "已开启" : "未开启"}
            </Text>
          </View>
          <View style={styles.statusCard}>
            <Text style={styles.statusLabel}>录音权限</Text>
            <Text style={styles.statusValue}>
              {nativeDetectionStatus.recordAudioPermissionGranted ? "已开启" : "未开启"}
            </Text>
          </View>
          <View style={styles.statusCard}>
            <Text style={styles.statusLabel}>悬浮提醒</Text>
            <Text style={styles.statusValue}>
              {nativeDetectionStatus.overlayPermissionGranted ? "已开启" : "未开启"}
            </Text>
          </View>
        </View>

        <View style={styles.panelCompact}>
          <Text style={styles.panelTitle}>最新预警</Text>
          <Text style={styles.panelBody} numberOfLines={3}>
            {latestRisk?.message || incomingRisk?.message || "开始检测后显示实时预警"}
          </Text>
        </View>

        <View style={styles.panelCompact}>
          <Text style={styles.panelTitle}>实时转写</Text>
          <Text style={styles.panelBody} numberOfLines={4}>
            {liveText || "开始检测后显示通话内容"}
          </Text>
        </View>

        <View style={styles.historyPanel}>
          <View style={styles.historyHead}>
            <Text style={styles.panelTitle}>历史记录</Text>
            <Pressable
              style={({ pressed }) => [styles.refreshButton, pressed && styles.pressed]}
              onPress={() => void refreshHistory()}
            >
              <MaterialCommunityIcons name="refresh" size={16} color={palette.accentStrong} />
              <Text style={styles.refreshText}>刷新</Text>
            </Pressable>
          </View>

          {recentSessions.length ? (
            <View style={styles.historyList}>
              {recentSessions.map((item) => {
                const tone = riskTone(item.risk_level_final);
                return (
                  <Pressable
                    key={item.id}
                    style={({ pressed }) => [styles.historyRow, pressed && styles.pressed]}
                    onPress={() =>
                      router.push({
                        pathname: "/call-intervention/[sessionId]",
                        params: { sessionId: item.id },
                      } as never)
                    }
                  >
                    <View style={styles.historyCopy}>
                      <Text style={styles.historyTitle} numberOfLines={1}>
                        {deriveCallSessionTitle(item)}
                      </Text>
                      <Text style={styles.historyMeta} numberOfLines={1}>
                        {formatCallPhoneLabel(item.phone_number)} · {formatTime(item.started_at)}
                      </Text>
                    </View>
                    <View style={[styles.historyRisk, { backgroundColor: tone.soft }]}>
                      <Text style={[styles.historyRiskText, { color: tone.tint }]}>
                        {tone.label}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyText}>暂无通话检测记录</Text>
            </View>
          )}
        </View>
      </View>
    </TaskScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    gap: 14,
  },
  headRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  headCopy: {
    flex: 1,
    gap: 4,
  },
  headTitle: {
    color: palette.ink,
    fontSize: 19,
    lineHeight: 24,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  headMeta: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 17,
    fontFamily: fontFamily.body,
  },
  statusBadge: {
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  statusBadgeText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  statusGrid: {
    flexDirection: "row",
    gap: 10,
  },
  statusCard: {
    flex: 1,
    borderRadius: radius.md,
    backgroundColor: palette.surfaceSoft,
    paddingHorizontal: 10,
    paddingVertical: 12,
    gap: 4,
  },
  statusLabel: {
    color: palette.inkSoft,
    fontSize: 11,
    lineHeight: 15,
    fontFamily: fontFamily.body,
  },
  statusValue: {
    color: palette.ink,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  panelCompact: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.surfaceSoft,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
  },
  historyPanel: {
    flex: 1,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.surfaceSoft,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  historyHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  panelTitle: {
    color: palette.ink,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  panelBody: {
    color: palette.inkSoft,
    fontSize: 13,
    lineHeight: 19,
    fontFamily: fontFamily.body,
  },
  refreshButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: palette.surface,
  },
  refreshText: {
    color: palette.accentStrong,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  historyList: {
    gap: 8,
  },
  historyRow: {
    minHeight: 56,
    borderRadius: radius.md,
    backgroundColor: palette.surface,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  historyCopy: {
    flex: 1,
    gap: 3,
  },
  historyTitle: {
    color: palette.ink,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  historyMeta: {
    color: palette.inkSoft,
    fontSize: 11,
    lineHeight: 15,
    fontFamily: fontFamily.body,
  },
  historyRisk: {
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  historyRiskText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  emptyWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: {
    color: palette.inkSoft,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  pressed: {
    opacity: 0.9,
  },
});
