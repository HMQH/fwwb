import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useFocusEffect } from "@react-navigation/native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "@/features/auth";
import { setUploadArchiveDraft } from "@/features/uploads/archive-session";
import { flattenUserUploads } from "@/features/uploads/asset-utils";
import { uploadsApi } from "@/features/uploads/api";
import type { UserUpload } from "@/features/uploads/types";
import { ApiError } from "@/shared/api";
import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";

import {
  clearRecentFloatingCaptureDraft,
  floatingCaptureService,
  patchRecentFloatingCaptureUpload,
  peekRecentFloatingCaptureDraft,
  setRecentFloatingCaptureDraft,
  type FloatingCaptureFile,
} from "./index";

function ActionCard({
  icon,
  label,
  disabled,
  onPress,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionCard,
        disabled && styles.actionCardDisabled,
        pressed && !disabled && styles.buttonPressed,
      ]}
    >
      <View style={styles.actionIconWrap}>
        <MaterialCommunityIcons name={icon} size={20} color={palette.accentStrong} />
      </View>
      <Text style={styles.actionLabel}>{label}</Text>
      <MaterialCommunityIcons name="chevron-right" size={20} color={palette.inkSoft} />
    </Pressable>
  );
}

export default function CaptureActionScreen() {
  const router = useRouter();
  const { captureId } = useLocalSearchParams<{ captureId?: string }>();
  const { token } = useAuth();
  const latestCaptureUriRef = useRef<string | null>(null);

  const [captureFile, setCaptureFile] = useState<FloatingCaptureFile | null>(null);
  const [upload, setUpload] = useState<UserUpload | null>(null);
  const [loadingCapture, setLoadingCapture] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const applyCapture = useCallback((file: FloatingCaptureFile | null, nextUpload: UserUpload | null) => {
    latestCaptureUriRef.current = file?.uri ?? null;
    setCaptureFile(file);
    setUpload(nextUpload);
  }, []);

  const loadCapture = useCallback(async () => {
    setLoadingCapture(true);

    const captured = await floatingCaptureService.consumePendingCapture();
    if (captured) {
      applyCapture(captured, null);
      setUploadError(null);
      setUploading(false);
      setRecentFloatingCaptureDraft({ file: captured, upload: null, target: null });
      setLoadingCapture(false);
      return;
    }

    const existing = peekRecentFloatingCaptureDraft();
    applyCapture(existing?.file ?? null, existing?.upload ?? null);
    setLoadingCapture(false);
  }, [applyCapture]);

  useEffect(() => {
    void loadCapture();
  }, [captureId, loadCapture]);

  useFocusEffect(
    useCallback(() => {
      void loadCapture();
    }, [loadCapture])
  );

  const uploadCapture = useCallback(
    async (file: FloatingCaptureFile) => {
      if (!token) {
        setUploadError("请先登录");
        return;
      }

      const targetUri = file.uri;
      setUploading(true);
      setUploadError(null);
      try {
        const result = await uploadsApi.uploadImage(file, token);
        if (latestCaptureUriRef.current !== targetUri) {
          return;
        }
        setUpload(result);
        patchRecentFloatingCaptureUpload(result);
      } catch (error) {
        if (latestCaptureUriRef.current !== targetUri) {
          return;
        }
        const message = error instanceof ApiError ? error.message : "保存失败";
        setUploadError(message);
      } finally {
        if (latestCaptureUriRef.current === targetUri) {
          setUploading(false);
        }
      }
    },
    [token]
  );

  useEffect(() => {
    if (!captureFile || upload || uploading || uploadError) {
      return;
    }
    void uploadCapture(captureFile);
  }, [captureFile, upload, uploading, uploadError, uploadCapture]);

  const previewSource = useMemo(() => {
    if (!captureFile) {
      return null;
    }
    return { uri: captureFile.uri };
  }, [captureFile]);

  const handleOpenAIFace = useCallback(() => {
    if (!captureFile || !upload) {
      return;
    }
    setRecentFloatingCaptureDraft({ file: captureFile, upload, target: "ai-face" });
    router.replace("/detect-ai-face" as never);
  }, [captureFile, router, upload]);

  const handleOpenVisual = useCallback(() => {
    if (!captureFile || !upload) {
      return;
    }
    setRecentFloatingCaptureDraft({ file: captureFile, upload, target: "visual" });
    router.replace("/detect-visual" as never);
  }, [captureFile, router, upload]);

  const handleArchive = useCallback(() => {
    if (!upload) {
      return;
    }

    const asset = flattenUserUploads([upload])[0];
    if (!asset) {
      Alert.alert("保存失败", "未找到图片记录");
      return;
    }

    clearRecentFloatingCaptureDraft();
    setUploadArchiveDraft([asset]);
    router.replace("/uploads/archive" as never);
  }, [router, upload]);

  return (
    <View style={styles.root}>
      <View style={styles.backgroundOrbTop} />
      <View style={styles.backgroundOrbBottom} />
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.headerRow}>
            <Pressable style={({ pressed }) => [styles.backButton, pressed && styles.buttonPressed]} onPress={() => router.back()}>
              <MaterialCommunityIcons name="chevron-left" size={20} color={palette.accentStrong} />
            </Pressable>
            <Text style={styles.title}>截图去向</Text>
            <View style={styles.headerSpacer} />
          </View>

          <View style={styles.previewCard}>
            {loadingCapture ? (
              <View style={styles.stateWrap}>
                <ActivityIndicator size="small" color={palette.accentStrong} />
                <Text style={styles.stateText}>读取中</Text>
              </View>
            ) : previewSource ? (
              <Image source={previewSource} style={styles.previewImage} contentFit="cover" />
            ) : (
              <View style={styles.stateWrap}>
                <MaterialCommunityIcons name="image-off-outline" size={22} color={palette.inkSoft} />
                <Text style={styles.stateText}>没有截图</Text>
              </View>
            )}
          </View>

          <View style={styles.statusCard}>
            <View style={styles.statusRow}>
              <Text style={styles.statusLabel}>上传</Text>
              {upload ? (
                <View style={styles.statusBadgeSuccess}>
                  <Text style={styles.statusBadgeTextSuccess}>已保存</Text>
                </View>
              ) : uploading ? (
                <View style={styles.statusBadgeNeutral}>
                  <ActivityIndicator size="small" color={palette.accentStrong} />
                  <Text style={styles.statusBadgeTextNeutral}>保存中</Text>
                </View>
              ) : uploadError ? (
                <View style={styles.statusBadgeError}>
                  <Text style={styles.statusBadgeTextError}>失败</Text>
                </View>
              ) : (
                <View style={styles.statusBadgeNeutral}>
                  <Text style={styles.statusBadgeTextNeutral}>等待</Text>
                </View>
              )}
            </View>

            {uploadError ? (
              <View style={styles.retryWrap}>
                <Text style={styles.errorText} numberOfLines={2}>
                  {uploadError}
                </Text>
                <Pressable
                  style={({ pressed }) => [styles.retryButton, pressed && styles.buttonPressed]}
                  onPress={() => {
                    if (captureFile) {
                      void uploadCapture(captureFile);
                    }
                  }}
                >
                  <MaterialCommunityIcons name="refresh" size={16} color={palette.accentStrong} />
                  <Text style={styles.retryText}>重试</Text>
                </Pressable>
              </View>
            ) : null}
          </View>

          <View style={styles.actionList}>
            <ActionCard
              icon="face-recognition"
              label="AI换脸"
              disabled={!upload || !captureFile}
              onPress={handleOpenAIFace}
            />
            <ActionCard
              icon="image-search-outline"
              label="图片检测"
              disabled={!upload || !captureFile}
              onPress={handleOpenVisual}
            />
            <ActionCard
              icon="archive-arrow-down-outline"
              label="归档到人"
              disabled={!upload}
              onPress={handleArchive}
            />
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.background },
  safeArea: { flex: 1 },
  backgroundOrbTop: {
    position: "absolute",
    top: -90,
    left: -34,
    width: 220,
    height: 220,
    borderRadius: 999,
    backgroundColor: "rgba(117, 167, 255, 0.14)",
  },
  backgroundOrbBottom: {
    position: "absolute",
    right: -74,
    bottom: 90,
    width: 220,
    height: 220,
    borderRadius: 999,
    backgroundColor: "rgba(196, 218, 255, 0.18)",
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 28,
    gap: 14,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  backButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
  },
  headerSpacer: {
    width: 38,
    height: 38,
  },
  title: {
    color: palette.ink,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  previewCard: {
    borderRadius: radius.xl,
    overflow: "hidden",
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    minHeight: 260,
    ...panelShadow,
  },
  previewImage: {
    width: "100%",
    aspectRatio: 0.78,
    backgroundColor: palette.backgroundDeep,
  },
  stateWrap: {
    minHeight: 260,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  stateText: {
    color: palette.inkSoft,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  statusCard: {
    borderRadius: radius.lg,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 12,
    ...panelShadow,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  statusLabel: {
    color: palette.ink,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  statusBadgeSuccess: {
    borderRadius: radius.pill,
    backgroundColor: "#E8F7ED",
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  statusBadgeTextSuccess: {
    color: "#218A4A",
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  statusBadgeNeutral: {
    borderRadius: radius.pill,
    backgroundColor: palette.surfaceSoft,
    paddingHorizontal: 12,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  statusBadgeTextNeutral: {
    color: palette.accentStrong,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  statusBadgeError: {
    borderRadius: radius.pill,
    backgroundColor: "#FFE7E7",
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  statusBadgeTextError: {
    color: "#C62828",
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  retryButton: {
    minHeight: 40,
    borderRadius: radius.pill,
    backgroundColor: palette.accentSoft,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
  },
  retryWrap: {
    gap: 10,
  },
  errorText: {
    color: "#C62828",
    fontSize: 12,
    lineHeight: 17,
    fontFamily: fontFamily.body,
  },
  retryText: {
    color: palette.accentStrong,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  actionList: {
    gap: 10,
  },
  actionCard: {
    minHeight: 64,
    borderRadius: radius.lg,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    ...panelShadow,
  },
  actionCardDisabled: {
    opacity: 0.45,
  },
  actionIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 16,
    backgroundColor: palette.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  actionLabel: {
    flex: 1,
    color: palette.ink,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  buttonPressed: {
    opacity: 0.9,
  },
});
