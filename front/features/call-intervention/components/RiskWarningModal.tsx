import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useEffect, useRef } from "react";
import { Animated, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { fontFamily, palette, radius } from "@/shared/theme";

import type { RiskLevel } from "../types";

type WarningState = {
  level: RiskLevel;
  message: string;
} | null;

const toneMap: Record<
  RiskLevel,
  {
    badge: string;
    soft: string;
    title: string;
    status: string;
  }
> = {
  low: {
    badge: "#2F70E6",
    soft: "#EAF2FF",
    title: "已识别当前来电",
    status: "保持通话警惕",
  },
  medium: {
    badge: "#FF9C48",
    soft: "#FFF4E7",
    title: "疑似风险来电",
    status: "建议先核验身份",
  },
  high: {
    badge: "#E05A4F",
    soft: "#FFF0EC",
    title: "高危诈骗来电",
    status: "建议立即开始取证录音",
  },
};

export function RiskWarningModal({
  visible,
  warning,
  phoneNumber,
  isRecording,
  transcriptPreview,
  onPrimaryAction,
  onClose,
}: {
  visible: boolean;
  warning: WarningState;
  phoneNumber?: string | null;
  isRecording: boolean;
  transcriptPreview?: string | null;
  onPrimaryAction: () => void;
  onClose: () => void;
}) {
  const tone = toneMap[warning?.level ?? "low"];
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!isRecording) {
      pulse.stopAnimation();
      pulse.setValue(1);
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.12, duration: 820, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.96, duration: 820, useNativeDriver: true }),
      ])
    );
    loop.start();

    return () => {
      loop.stop();
      pulse.setValue(1);
    };
  }, [isRecording, pulse]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <View style={[styles.levelBadge, { backgroundColor: tone.soft }]}>
              <Text style={[styles.levelBadgeText, { color: tone.badge }]}>
                {warning?.level === "high" ? "高危预警" : warning?.level === "medium" ? "风险提醒" : "来电识别"}
              </Text>
            </View>
            <Pressable style={styles.closeButton} onPress={onClose}>
              <MaterialCommunityIcons name="close" size={18} color={palette.inkSoft} />
            </Pressable>
          </View>

          <Text style={styles.title}>{isRecording ? "录音进行中" : tone.title}</Text>
          <Text style={styles.phoneText}>{phoneNumber?.trim() || "未知号码"}</Text>
          <Text style={styles.message}>{warning?.message ?? tone.status}</Text>

          <View style={styles.panel}>
            <View style={styles.panelHeader}>
              <Animated.View
                style={[
                  styles.pulseWrap,
                  { backgroundColor: isRecording ? "rgba(255, 163, 74, 0.18)" : "rgba(45, 140, 91, 0.14)", transform: [{ scale: pulse }] },
                ]}
              >
                <View style={[styles.pulseDot, { backgroundColor: isRecording ? "#FF9A32" : "#2D8C5B" }]} />
              </Animated.View>
              <View style={styles.panelMeta}>
                <Text style={styles.panelTitle}>{isRecording ? "正在实时录音" : "可立即开始取证"}</Text>
                <Text style={styles.panelSubTitle}>{isRecording ? "点击按钮可结束录音并保存" : "绿色按钮会直接启动录音与实时转写"}</Text>
              </View>
            </View>

            <View style={styles.transcriptMarquee}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.transcriptContent}>
                <Text style={styles.transcriptText}>
                  {(transcriptPreview && transcriptPreview.trim()) || (isRecording ? "正在等待最新 ASR 文本..." : "你也可以先进入 App 查看完整来电分析与历史记录。")}
                </Text>
              </ScrollView>
            </View>
          </View>

          <View style={styles.actionRow}>
            <Pressable
              style={({ pressed }) => [styles.primaryButton, isRecording && styles.primaryButtonDanger, pressed && styles.buttonPressed]}
              onPress={onPrimaryAction}
            >
              <MaterialCommunityIcons name={isRecording ? "stop-circle-outline" : "record-rec"} size={18} color={palette.white} />
              <Text style={styles.primaryButtonText}>{isRecording ? "结束录音" : "启用录音"}</Text>
            </Pressable>
            <Pressable style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]} onPress={onClose}>
              <Text style={styles.secondaryButtonText}>{isRecording ? "收起提醒" : "进入 App 查看"}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(16, 28, 46, 0.54)",
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  card: {
    borderRadius: radius.xl,
    backgroundColor: palette.surface,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 16,
    gap: 12,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  levelBadge: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.pill,
  },
  levelBadgeText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  closeButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.surfaceSoft,
  },
  title: {
    color: palette.ink,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  phoneText: {
    color: palette.accentStrong,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  message: {
    color: palette.inkSoft,
    fontSize: 14,
    lineHeight: 21,
    fontFamily: fontFamily.body,
  },
  panel: {
    borderRadius: radius.lg,
    backgroundColor: palette.surfaceSoft,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 12,
  },
  panelHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  pulseWrap: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
  },
  pulseDot: {
    width: 18,
    height: 18,
    borderRadius: 999,
  },
  panelMeta: {
    flex: 1,
    gap: 2,
  },
  panelTitle: {
    color: palette.ink,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  panelSubTitle: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  transcriptMarquee: {
    minHeight: 40,
    borderRadius: radius.md,
    backgroundColor: palette.white,
    borderWidth: 1,
    borderColor: palette.line,
    justifyContent: "center",
  },
  transcriptContent: {
    paddingHorizontal: 12,
    alignItems: "center",
  },
  transcriptText: {
    color: palette.ink,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: fontFamily.body,
  },
  actionRow: {
    flexDirection: "row",
    gap: 10,
  },
  primaryButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: radius.pill,
    backgroundColor: "#2D8C5B",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  primaryButtonDanger: {
    backgroundColor: "#D45555",
  },
  primaryButtonText: {
    color: palette.white,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  secondaryButton: {
    minWidth: 112,
    minHeight: 48,
    borderRadius: radius.pill,
    backgroundColor: palette.surfaceSoft,
    borderWidth: 1,
    borderColor: palette.line,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonText: {
    color: palette.inkSoft,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  buttonPressed: {
    opacity: 0.92,
  },
});
