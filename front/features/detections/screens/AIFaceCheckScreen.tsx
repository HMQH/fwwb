import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, LayoutChangeEvent, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "@/features/auth";
import { consumeStagedFloatingCapture } from "@/features/floating-capture";
import { ApiError } from "@/shared/api";
import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";

import { detectionsApi } from "../api";
import type { AIFaceCheckResponse, PickedFile } from "../types";

type PickedImage = PickedFile & {
  width?: number;
  height?: number;
};

type PreviewLayout = {
  width: number;
  height: number;
};

function clamp01(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }
  return Math.max(0, Math.min(1, value));
}

function toPercent(value?: number | null) {
  const normalized = clamp01(value);
  if (normalized === null) {
    return "--";
  }
  return `${Math.round(normalized * 100)}%`;
}

function getStatusText(result: AIFaceCheckResponse | null) {
  if (!result) {
    return "待检测";
  }
  if (result.num_faces === 0) {
    return "未检测到人脸";
  }
  return result.is_ai_face ? "疑似换脸" : "结果正常";
}

function getStatusColor(result: AIFaceCheckResponse | null) {
  if (!result) {
    return {
      backgroundColor: palette.accentSoft,
      textColor: palette.accentStrong,
    };
  }

  if (result.num_faces === 0) {
    return {
      backgroundColor: palette.surfaceSoft,
      textColor: palette.inkSoft,
    };
  }

  if (result.is_ai_face) {
    return {
      backgroundColor: "#FFE7E7",
      textColor: "#C62828",
    };
  }

  return {
    backgroundColor: "#E8F7ED",
    textColor: "#218A4A",
  };
}

export function AIFaceCheckScreen() {
  const router = useRouter();
  const { token } = useAuth();

  const [pickedImage, setPickedImage] = useState<PickedImage | null>(null);
  const [result, setResult] = useState<AIFaceCheckResponse | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [previewLayout, setPreviewLayout] = useState<PreviewLayout>({ width: 0, height: 0 });
  const [autoSubmitPending, setAutoSubmitPending] = useState(false);

  const statusStyle = useMemo(() => getStatusColor(result), [result]);
  const statusText = useMemo(() => getStatusText(result), [result]);

  const previewAspectRatio = useMemo(() => {
    if (result?.image_size?.width && result?.image_size?.height) {
      return result.image_size.width / result.image_size.height;
    }
    if (pickedImage?.width && pickedImage?.height) {
      return pickedImage.width / pickedImage.height;
    }
    return 1;
  }, [pickedImage, result]);

  const overlayFaces = useMemo(() => {
    if (!result || result.num_faces === 0) {
      return [];
    }
    if (!previewLayout.width || !previewLayout.height) {
      return [];
    }

    const sourceWidth = result.image_size?.width || 1;
    const sourceHeight = result.image_size?.height || 1;
    const scaleX = previewLayout.width / sourceWidth;
    const scaleY = previewLayout.height / sourceHeight;

    return result.faces.map((face) => {
      const [x0, y0, x1, y1] = face.bbox;
      return {
        ...face,
        left: x0 * scaleX,
        top: y0 * scaleY,
        width: Math.max(1, (x1 - x0) * scaleX),
        height: Math.max(1, (y1 - y0) * scaleY),
      };
    });
  }, [previewLayout, result]);

  const onPreviewLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setPreviewLayout({ width, height });
  }, []);

  const applyPickedImage = useCallback((image: PickedImage) => {
    setPickedImage(image);
    setResult(null);
  }, []);

  useFocusEffect(
    useCallback(() => {
      const stagedCapture = consumeStagedFloatingCapture("ai-face");
      if (!stagedCapture) {
        return;
      }

      applyPickedImage({
        uri: stagedCapture.file.uri,
        name: stagedCapture.file.name,
        type: stagedCapture.file.type,
      });
      setAutoSubmitPending(true);
    }, [applyPickedImage])
  );

  const pickImage = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("需要相册权限", "请开启相册权限");
      return;
    }

    const selection = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: false,
      quality: 0.95,
    });

    if (selection.canceled || !selection.assets.length) {
      return;
    }

    const asset = selection.assets[0];
    applyPickedImage({
      uri: asset.uri,
      name: asset.fileName ?? `ai-face-${Date.now()}.jpg`,
      type: asset.mimeType ?? "image/jpeg",
      width: asset.width,
      height: asset.height,
    });
    setAutoSubmitPending(false);
  }, [applyPickedImage]);

  const submit = useCallback(async () => {
    if (!token) {
      Alert.alert("未登录", "请先登录");
      return;
    }
    if (!pickedImage) {
      Alert.alert("缺少图片", "请先选图");
      return;
    }

    setSubmitting(true);
    try {
      const response = await detectionsApi.checkAIFace(token, pickedImage);
      setResult(response);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "检测失败";
      Alert.alert("检测失败", message);
    } finally {
      setSubmitting(false);
    }
  }, [pickedImage, token]);

  useEffect(() => {
    if (!autoSubmitPending || !pickedImage || !token || submitting) {
      return;
    }
    setAutoSubmitPending(false);
    void submit();
  }, [autoSubmitPending, pickedImage, submit, submitting, token]);

  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.pageHeader}>
          <Pressable style={({ pressed }) => [styles.pageBackButton, pressed && styles.pressed]} onPress={() => router.back()}>
            <MaterialCommunityIcons name="chevron-left" size={20} color={palette.accentStrong} />
          </Pressable>
          <Text style={styles.pageTitle}>AI 换脸识别</Text>
          <View style={styles.pageHeaderSpacer} />
        </View>

        <View style={styles.card}>
          <View style={styles.headerRow}>
            <Text style={styles.title}>AI 换脸识别</Text>
            <View style={[styles.badge, { backgroundColor: statusStyle.backgroundColor }]}>
              <Text style={[styles.badgeText, { color: statusStyle.textColor }]}>{statusText}</Text>
            </View>
          </View>

          <View style={styles.actionRow}>
            <Pressable style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressed]} onPress={pickImage}>
              <MaterialCommunityIcons name="image-plus-outline" size={18} color={palette.accentStrong} />
              <Text style={styles.secondaryBtnText}>选图</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.primaryBtn,
                pressed && !submitting && styles.pressed,
                (!pickedImage || submitting) && styles.disabledBtn,
              ]}
              onPress={submit}
              disabled={!pickedImage || submitting}
            >
              <Text style={styles.primaryBtnText}>{submitting ? "检测中" : "开始"}</Text>
            </Pressable>
          </View>

          <Pressable style={({ pressed }) => [styles.uploadBox, pressed && styles.pressed]} onPress={pickImage}>
            {pickedImage ? (
              <View style={[styles.previewFrame, { aspectRatio: previewAspectRatio }]} onLayout={onPreviewLayout}>
                <Image source={{ uri: pickedImage.uri }} style={styles.preview} contentFit="cover" />
                {overlayFaces.map((face) => {
                  const isFake = face.label === "fake";
                  return (
                    <View
                      key={`face-${face.face_id}`}
                      style={[
                        styles.faceBox,
                        {
                          left: face.left,
                          top: face.top,
                          width: face.width,
                          height: face.height,
                          borderColor: isFake ? "#E53935" : "#1B9C5A",
                        },
                      ]}
                    >
                      <View
                        style={[
                          styles.faceTag,
                          { backgroundColor: isFake ? "rgba(229,57,53,0.92)" : "rgba(27,156,90,0.92)" },
                        ]}
                      >
                        <Text style={styles.faceTagText}>
                          {face.face_id + 1} {face.label}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            ) : (
              <View style={styles.placeholder}>
                <MaterialCommunityIcons name="image-search-outline" size={34} color={palette.accentStrong} />
                <Text style={styles.placeholderText}>点击选图</Text>
              </View>
            )}
          </Pressable>

          <View style={styles.metaGrid}>
            <View style={styles.metaCard}>
              <Text style={styles.metaLabel}>图像判定</Text>
              <Text style={styles.metaValue}>{result ? (result.is_ai_face ? "疑似伪造" : "结果正常") : "--"}</Text>
            </View>
            <View style={styles.metaCard}>
              <Text style={styles.metaLabel}>检测人脸</Text>
              <Text style={styles.metaValue}>{result ? String(result.num_faces) : "--"}</Text>
            </View>
            <View style={styles.metaCard}>
              <Text style={styles.metaLabel}>上传记录</Text>
              <Text style={styles.metaValue}>{result?.stored_file_path ? "已入库" : "--"}</Text>
            </View>
          </View>

          {result?.submission_id ? (
            <Pressable
              style={({ pressed }) => [styles.recordBtn, pressed && styles.pressed]}
              onPress={() => router.push({ pathname: "/records/[id]", params: { id: result.submission_id! } })}
            >
              <MaterialCommunityIcons name="history" size={16} color={palette.accentStrong} />
              <Text style={styles.recordBtnText}>查看记录</Text>
            </Pressable>
          ) : null}
        </View>

        {result ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>检测结果</Text>
            {result.faces.length ? (
              <View style={styles.faceList}>
                {result.faces.map((face) => {
                  const isFake = face.label === "fake";
                  const fakePercent = toPercent(face.fake_score);
                  const realPercent = toPercent(1 - face.fake_score);
                  return (
                    <View key={`face-card-${face.face_id}`} style={styles.faceCard}>
                      <View style={styles.faceCardHeader}>
                        <View style={styles.faceCardTitleWrap}>
                          <Text style={styles.faceCardTitle}>人像 {face.face_id + 1}</Text>
                          <View
                            style={[
                              styles.faceLabelBadge,
                              { backgroundColor: isFake ? "#FFE7E7" : "#E8F7ED" },
                            ]}
                          >
                            <Text
                              style={[
                                styles.faceLabelText,
                                { color: isFake ? "#C62828" : "#218A4A" },
                              ]}
                            >
                              {isFake ? "fake" : "real"}
                            </Text>
                          </View>
                        </View>
                        <Text style={styles.faceScoreText}>{isFake ? fakePercent : realPercent}</Text>
                      </View>

                      <View style={styles.faceMetricsRow}>
                        <View style={styles.faceMetric}>
                          <Text style={styles.faceMetricLabel}>fake</Text>
                          <Text style={styles.faceMetricValue}>{fakePercent}</Text>
                        </View>
                        <View style={styles.faceMetric}>
                          <Text style={styles.faceMetricLabel}>real</Text>
                          <Text style={styles.faceMetricValue}>{realPercent}</Text>
                        </View>
                      </View>
                    </View>
                  );
                })}
              </View>
            ) : (
              <View style={styles.emptyResult}>
                <Text style={styles.emptyResultText}>未检测到人脸</Text>
              </View>
            )}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: palette.background,
  },
  container: {
    padding: 16,
    paddingBottom: 28,
    gap: 14,
  },
  pageHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  pageBackButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
  },
  pageTitle: {
    color: palette.ink,
    fontSize: 20,
    lineHeight: 24,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  pageHeaderSpacer: {
    width: 38,
    height: 38,
  },
  card: {
    borderRadius: radius.lg,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    padding: 16,
    gap: 14,
    ...panelShadow,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  title: {
    flex: 1,
    fontSize: 22,
    color: palette.ink,
    fontFamily: fontFamily.display,
    fontWeight: "700",
  },
  badge: {
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  badgeText: {
    fontFamily: fontFamily.body,
    fontWeight: "700",
    fontSize: 12,
  },
  actionRow: {
    flexDirection: "row",
    gap: 10,
  },
  secondaryBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.surfaceSoft,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  secondaryBtnText: {
    color: palette.accentStrong,
    fontFamily: fontFamily.body,
    fontSize: 14,
    fontWeight: "700",
  },
  uploadBox: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.line,
    overflow: "hidden",
    backgroundColor: palette.surfaceSoft,
  },
  previewFrame: {
    width: "100%",
    position: "relative",
    backgroundColor: palette.backgroundMuted,
  },
  preview: {
    ...StyleSheet.absoluteFillObject,
  },
  placeholder: {
    minHeight: 260,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: 20,
  },
  placeholderText: {
    color: palette.ink,
    fontFamily: fontFamily.body,
    fontSize: 16,
    fontWeight: "700",
  },
  faceBox: {
    position: "absolute",
    borderWidth: 2,
    borderRadius: 10,
  },
  faceTag: {
    position: "absolute",
    top: -28,
    left: 0,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  faceTagText: {
    color: palette.white,
    fontFamily: fontFamily.body,
    fontSize: 11,
    fontWeight: "700",
  },
  metaGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  metaCard: {
    flex: 1,
    minWidth: 92,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.surfaceSoft,
    padding: 12,
    gap: 6,
  },
  metaLabel: {
    color: palette.inkSoft,
    fontFamily: fontFamily.body,
    fontSize: 12,
  },
  metaValue: {
    color: palette.ink,
    fontFamily: fontFamily.display,
    fontSize: 17,
    fontWeight: "700",
  },
  primaryBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.md,
    backgroundColor: palette.accentStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnText: {
    color: palette.white,
    fontFamily: fontFamily.body,
    fontSize: 16,
    fontWeight: "700",
  },
  disabledBtn: {
    opacity: 0.7,
  },
  recordBtn: {
    minHeight: 42,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.surfaceSoft,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  recordBtnText: {
    color: palette.accentStrong,
    fontFamily: fontFamily.body,
    fontSize: 13,
    fontWeight: "700",
  },
  pressed: {
    opacity: 0.86,
  },
  sectionTitle: {
    color: palette.ink,
    fontFamily: fontFamily.display,
    fontSize: 19,
    fontWeight: "700",
  },
  faceList: {
    gap: 12,
  },
  faceCard: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.surfaceSoft,
    padding: 14,
    gap: 10,
  },
  faceCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  faceCardTitleWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  faceCardTitle: {
    color: palette.ink,
    fontFamily: fontFamily.display,
    fontSize: 16,
    fontWeight: "700",
  },
  faceLabelBadge: {
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  faceLabelText: {
    fontFamily: fontFamily.body,
    fontSize: 11,
    fontWeight: "700",
  },
  faceScoreText: {
    color: palette.accentStrong,
    fontFamily: fontFamily.display,
    fontSize: 18,
    fontWeight: "700",
  },
  faceMetricsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  faceMetric: {
    flex: 1,
    minWidth: 120,
    gap: 4,
  },
  faceMetricLabel: {
    color: palette.inkSoft,
    fontFamily: fontFamily.body,
    fontSize: 12,
  },
  faceMetricValue: {
    color: palette.ink,
    fontFamily: fontFamily.body,
    fontSize: 13,
    fontWeight: "600",
  },
  emptyResult: {
    minHeight: 84,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.surfaceSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyResultText: {
    color: palette.inkSoft,
    fontFamily: fontFamily.body,
    fontSize: 13,
    fontWeight: "600",
  },
});
