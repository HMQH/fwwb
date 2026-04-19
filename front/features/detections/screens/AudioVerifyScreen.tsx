import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { useCallback, useMemo, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";

import { useAuth } from "@/features/auth";
import { ApiError } from "@/shared/api";
import { fontFamily, palette, radius } from "@/shared/theme";
import { TaskPrimaryButton, TaskScreen } from "@/shared/ui/TaskScreen";

import { detectionsApi } from "../api";
import type { AudioVerifyResponse, PickedFile } from "../types";

function formatPercent(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "--";
  }
  return `${Math.round(value * 100)}%`;
}

function formatSeconds(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "--";
  }
  return value >= 10 ? `${value.toFixed(1)}s` : `${value.toFixed(2)}s`;
}

export function AudioVerifyScreen() {
  const { token } = useAuth();
  const [pickedAudio, setPickedAudio] = useState<PickedFile | null>(null);
  const [result, setResult] = useState<AudioVerifyResponse | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const pickAudio = useCallback(async () => {
    const doc = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: false,
      type: "audio/*",
    });

    if (doc.canceled || !doc.assets.length) {
      return;
    }

    const asset = doc.assets[0];
    setResult(null);
    setPickedAudio({
      uri: asset.uri,
      name: asset.name,
      type: asset.mimeType ?? "audio/mpeg",
    });
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!pickedAudio) {
      void pickAudio();
      return;
    }
    if (!token) {
      Alert.alert("未登录", "请先登录");
      return;
    }

    setSubmitting(true);
    try {
      const next = await detectionsApi.verifyAudio(token, pickedAudio);
      setResult(next);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "识别失败";
      Alert.alert("识别失败", message);
    } finally {
      setSubmitting(false);
    }
  }, [pickAudio, pickedAudio, token]);

  const buttonLabel = useMemo(() => {
    if (!pickedAudio) {
      return "上传音频";
    }
    if (result) {
      return "重新上传";
    }
    return "开始识别";
  }, [pickedAudio, result]);

  const status = useMemo(() => {
    if (!result) {
      return { label: "未识别", tint: palette.inkSoft, soft: palette.surfaceSoft };
    }
    if (String(result.label).toLowerCase() === "fake") {
      return { label: "疑似AI合成", tint: "#D9485F", soft: "#FFF0F0" };
    }
    return { label: "真人概率更高", tint: "#1E8E5A", soft: "#EDF8F1" };
  }, [result]);

  return (
    <TaskScreen
      title="AI语音识别"
      footer={(
        <TaskPrimaryButton
          label={buttonLabel}
          onPress={() => {
            if (!pickedAudio || result) {
              void pickAudio();
              return;
            }
            void handleSubmit();
          }}
          loading={submitting}
        />
      )}
    >
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.headRow}>
          <View style={styles.iconWrap}>
            <MaterialCommunityIcons name="microphone-outline" size={22} color="#18A999" />
          </View>
          <Text style={styles.headTitle}>AI语音识别</Text>
        </View>

        <View style={styles.fileCard}>
          <View style={styles.fileIconWrap}>
            <MaterialCommunityIcons name="file-music-outline" size={24} color="#18A999" />
          </View>
          <Text style={styles.fileName} numberOfLines={2}>
            {pickedAudio?.name ?? "未上传音频"}
          </Text>
        </View>

        <View style={styles.resultCard}>
          <View style={[styles.statusBadge, { backgroundColor: status.soft }]}>
            <Text style={[styles.statusBadgeText, { color: status.tint }]}>
              {status.label}
            </Text>
          </View>

          <View style={styles.metricRow}>
            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>合成</Text>
              <Text style={styles.metricValue}>{formatPercent(result?.fake_prob)}</Text>
            </View>
            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>真人</Text>
              <Text style={styles.metricValue}>{formatPercent(result?.genuine_prob)}</Text>
            </View>
            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>时长</Text>
              <Text style={styles.metricValue}>{formatSeconds(result?.duration_sec)}</Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </TaskScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 16,
    paddingBottom: 6,
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
    backgroundColor: "#E9FBF7",
  },
  headTitle: {
    flex: 1,
    color: palette.ink,
    fontSize: 19,
    lineHeight: 24,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  fileCard: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.surfaceSoft,
    paddingHorizontal: 14,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  fileIconWrap: {
    width: 46,
    height: 46,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.surface,
  },
  fileName: {
    flex: 1,
    color: palette.ink,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  resultCard: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.surfaceSoft,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 14,
  },
  statusBadge: {
    alignSelf: "flex-start",
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
  metricRow: {
    flexDirection: "row",
    gap: 10,
  },
  metricCard: {
    flex: 1,
    borderRadius: radius.md,
    backgroundColor: palette.surface,
    paddingHorizontal: 10,
    paddingVertical: 12,
    gap: 4,
  },
  metricLabel: {
    color: palette.inkSoft,
    fontSize: 11,
    lineHeight: 15,
    fontFamily: fontFamily.body,
  },
  metricValue: {
    color: palette.ink,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
});
