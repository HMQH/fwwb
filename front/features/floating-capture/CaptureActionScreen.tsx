import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

import { useAuth } from "@/features/auth";
import { uploadsApi } from "@/features/uploads/api";
import { ApiError } from "@/shared/api";
import { fontFamily, palette, radius } from "@/shared/theme";
import { TaskPrimaryButton, TaskScreen } from "@/shared/ui/TaskScreen";

import { floatingCaptureService } from "./service";
import {
  clearRecentFloatingCaptureDraft,
  patchRecentFloatingCaptureUpload,
  peekRecentFloatingCaptureDraft,
  setRecentFloatingCaptureDraft,
  stageRecentFloatingCapture,
  type FloatingCaptureFile,
} from "./session";
import type { FloatingCaptureStatus } from "./types";

const fallbackStatus: FloatingCaptureStatus = {
  platformSupported: false,
  overlayPermission: false,
  bubbleActive: false,
  hasPendingCapture: false,
  screenCapturePermission: false,
};

export default function CaptureActionScreen() {
  const router = useRouter();
  const { token } = useAuth();
  const [captureStatus, setCaptureStatus] = useState<FloatingCaptureStatus>(fallbackStatus);
  const [captureFile, setCaptureFile] = useState<FloatingCaptureFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [archiving, setArchiving] = useState(false);

  const loadCapture = useCallback(async () => {
    setLoading(true);
    const status = await floatingCaptureService.getStatus();
    setCaptureStatus(status);

    const captured = await floatingCaptureService.consumePendingCapture();
    if (captured) {
      setRecentFloatingCaptureDraft({ file: captured });
      setCaptureFile(captured);
      setLoading(false);
      return;
    }

    setCaptureFile(peekRecentFloatingCaptureDraft()?.file ?? null);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadCapture();
    }, [loadCapture]),
  );

  const actionLabel = useMemo(() => {
    if (loading) {
      return "读取中";
    }
    if (captureFile) {
      return "继续截图";
    }
    if (!floatingCaptureService.isSupported()) {
      return "当前设备不支持";
    }
    if (!captureStatus.overlayPermission) {
      return "开启悬浮权限";
    }
    return captureStatus.bubbleActive ? "关闭悬浮助手" : "开启悬浮助手";
  }, [captureFile, captureStatus.bubbleActive, captureStatus.overlayPermission, loading]);

  const openTarget = useCallback(
    (target: "visual" | "ai-face") => {
      stageRecentFloatingCapture(target);
      if (target === "ai-face") {
        router.replace("/detect-ai-face" as never);
        return;
      }
      router.replace("/detect-visual?feature=image" as never);
    },
    [router],
  );

  const archiveToUploads = useCallback(async () => {
    if (!captureFile) {
      return;
    }
    if (!token) {
      Alert.alert("未登录", "请先登录");
      return;
    }

    setArchiving(true);
    try {
      const upload = await uploadsApi.uploadImage(captureFile, token);
      patchRecentFloatingCaptureUpload(upload);
      router.replace("/uploads" as never);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "归档失败";
      Alert.alert("归档失败", message);
    } finally {
      setArchiving(false);
    }
  }, [captureFile, router, token]);

  const handlePrimaryPress = useCallback(async () => {
    if (loading) {
      return;
    }

    if (captureFile) {
      clearRecentFloatingCaptureDraft();
      setCaptureFile(null);
      if (!captureStatus.bubbleActive && floatingCaptureService.isSupported() && captureStatus.overlayPermission) {
        const nextStatus = await floatingCaptureService.startAssistant();
        setCaptureStatus(nextStatus);
      }
      return;
    }

    if (!floatingCaptureService.isSupported()) {
      Alert.alert("当前设备不支持", "仅安卓 development build 支持悬浮截图");
      return;
    }

    if (!captureStatus.overlayPermission) {
      floatingCaptureService.openOverlaySettings();
      return;
    }

    if (captureStatus.bubbleActive) {
      const nextStatus = await floatingCaptureService.stopAssistant();
      setCaptureStatus(nextStatus);
      return;
    }

    const nextStatus = await floatingCaptureService.startAssistant();
    setCaptureStatus(nextStatus);
    Alert.alert("悬浮助手已开启", "切到任意页面后即可截图");
  }, [captureFile, captureStatus.bubbleActive, captureStatus.overlayPermission, loading]);

  return (
    <TaskScreen
      title="悬浮窗截图"
      footer={
        <TaskPrimaryButton
          label={actionLabel}
          onPress={() => void handlePrimaryPress()}
          disabled={loading}
        />
      }
    >
      <View style={styles.content}>
        <View style={styles.headRow}>
          <View style={[styles.iconWrap, { backgroundColor: "#EEF5FF" }]}>
            <MaterialCommunityIcons
              name="gesture-tap-button"
              size={22}
              color="#4C7DFF"
            />
          </View>
          <View style={styles.headCopy}>
            <Text style={styles.headTitle}>悬浮窗截图</Text>
            <Text style={styles.headMeta}>
              {captureFile ? "截图已就绪" : captureStatus.bubbleActive ? "助手已开启" : "待开启"}
            </Text>
          </View>
        </View>

        <View style={styles.statusGrid}>
          <View style={styles.statusCard}>
            <Text style={styles.statusLabel}>悬浮权限</Text>
            <Text style={styles.statusValue}>
              {captureStatus.overlayPermission ? "已开启" : "未开启"}
            </Text>
          </View>
          <View style={styles.statusCard}>
            <Text style={styles.statusLabel}>助手状态</Text>
            <Text style={styles.statusValue}>
              {captureStatus.bubbleActive ? "运行中" : "未运行"}
            </Text>
          </View>
          <View style={styles.statusCard}>
            <Text style={styles.statusLabel}>待处理截图</Text>
            <Text style={styles.statusValue}>{captureFile ? "1 张" : "0 张"}</Text>
          </View>
        </View>

        <View style={styles.previewWrap}>
          {captureFile ? (
            <Image
              source={{ uri: captureFile.uri }}
              style={styles.previewImage}
              contentFit="contain"
            />
          ) : (
            <View style={styles.previewEmpty}>
              <MaterialCommunityIcons
                name="image-outline"
                size={28}
                color={palette.inkSoft}
              />
              <Text style={styles.previewEmptyText}>截图会显示在这里</Text>
            </View>
          )}
        </View>

        {captureFile ? (
          <View style={styles.targetGrid}>
            <Pressable
              style={({ pressed }) => [styles.targetCard, pressed && styles.pressed]}
              onPress={() => openTarget("visual")}
            >
              <View style={[styles.targetIconWrap, { backgroundColor: "#F2EEFF" }]}>
                <MaterialCommunityIcons name="image-search-outline" size={18} color="#6C63FF" />
              </View>
              <Text style={styles.targetTitle}>图片检测</Text>
              <Text style={styles.targetMeta}>进入图片检测</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.targetCard, pressed && styles.pressed]}
              onPress={() => openTarget("ai-face")}
            >
              <View style={[styles.targetIconWrap, { backgroundColor: "#FFF1F8" }]}>
                <MaterialCommunityIcons name="face-recognition" size={18} color="#D65FA1" />
              </View>
              <Text style={styles.targetTitle}>AI换脸检测</Text>
              <Text style={styles.targetMeta}>进入AI换脸鉴别</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [
                styles.targetCard,
                styles.targetCardWide,
                archiving && styles.targetCardDisabled,
                pressed && styles.pressed,
              ]}
              disabled={archiving}
              onPress={() => void archiveToUploads()}
            >
              <View style={[styles.targetIconWrap, { backgroundColor: "#EEF5FF" }]}>
                <MaterialCommunityIcons name="folder-upload-outline" size={18} color="#4C7DFF" />
              </View>
              <Text style={styles.targetTitle}>归档到上传管理</Text>
              <Text style={styles.targetMeta}>{archiving ? "归档中" : "上传后进入上传管理"}</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </TaskScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    gap: 16,
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
  previewWrap: {
    flex: 1,
    minHeight: 210,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.line,
    overflow: "hidden",
    backgroundColor: palette.surfaceSoft,
  },
  previewImage: {
    width: "100%",
    height: "100%",
  },
  previewEmpty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  previewEmptyText: {
    color: palette.inkSoft,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  targetGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  targetCard: {
    width: "48%",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.surfaceSoft,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 8,
  },
  targetCardWide: {
    width: "100%",
  },
  targetCardDisabled: {
    opacity: 0.6,
  },
  targetIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  targetTitle: {
    color: palette.ink,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  targetMeta: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 17,
    fontFamily: fontFamily.body,
  },
  pressed: {
    opacity: 0.9,
  },
});
