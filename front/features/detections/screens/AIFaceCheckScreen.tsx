import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";

import { useAuth } from "@/features/auth";
import { consumeStagedFloatingCapture } from "@/features/floating-capture";
import { ApiError } from "@/shared/api";
import { fontFamily, palette, radius } from "@/shared/theme";
import { TaskPrimaryButton, TaskScreen } from "@/shared/ui/TaskScreen";

import { detectionsApi } from "../api";
import type { AIFaceCheckResponse, PickedFile } from "../types";

type PickedImage = PickedFile & {
  width?: number;
  height?: number;
};

function formatPercent(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "--";
  }
  return `${Math.round(value * 100)}%`;
}

export function AIFaceCheckScreen() {
  const router = useRouter();
  const { token } = useAuth();
  const [pickedImage, setPickedImage] = useState<PickedImage | null>(null);
  const [result, setResult] = useState<AIFaceCheckResponse | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useFocusEffect(
    useCallback(() => {
      const staged = consumeStagedFloatingCapture("ai-face");
      if (!staged?.file) {
        return;
      }

      setPickedImage(staged.file);
      setResult(null);
    }, []),
  );

  const pickImage = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("需要相册权限", "请先允许访问相册");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: false,
      quality: 0.95,
    });

    if (result.canceled || !result.assets.length) {
      return;
    }

    const asset = result.assets[0];
    setResult(null);
    setPickedImage({
      uri: asset.uri,
      name: asset.fileName ?? `ai-face-${Date.now()}.jpg`,
      type: asset.mimeType ?? "image/jpeg",
      width: asset.width,
      height: asset.height,
    });
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!pickedImage) {
      void pickImage();
      return;
    }
    if (!token) {
      Alert.alert("未登录", "请先登录");
      return;
    }

    setSubmitting(true);
    try {
      const next = await detectionsApi.checkAIFace(token, pickedImage);
      if (next.submission_id) {
        router.replace({
          pathname: "/records/[id]",
          params: { id: next.submission_id },
        });
        return;
      }
      setResult(next);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "鉴别失败";
      Alert.alert("鉴别失败", message);
    } finally {
      setSubmitting(false);
    }
  }, [pickImage, pickedImage, router, token]);

  const buttonLabel = useMemo(() => {
    if (!pickedImage) {
      return "上传图片";
    }
    if (result) {
      return "重新上传";
    }
    return "开始鉴别";
  }, [pickedImage, result]);

  const status = useMemo(() => {
    if (!result) {
      return { label: "未检测", tint: palette.inkSoft, soft: palette.surfaceSoft };
    }
    if (result.num_faces === 0) {
      return { label: "未检测到人脸", tint: palette.inkSoft, soft: palette.surfaceSoft };
    }
    if (result.is_ai_face) {
      return { label: "疑似AI换脸", tint: "#D9485F", soft: "#FFF0F0" };
    }
    return { label: "真人人脸", tint: "#1E8E5A", soft: "#EDF8F1" };
  }, [result]);

  return (
    <TaskScreen
      title="AI换脸检测"
      footer={
        <TaskPrimaryButton
          label={buttonLabel}
          onPress={() => {
            if (!pickedImage || result) {
              void pickImage();
              return;
            }
            void handleSubmit();
          }}
          loading={submitting}
        />
      }
    >
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.headRow}>
          <View style={[styles.iconWrap, { backgroundColor: "#FFF1F8" }]}>
            <MaterialCommunityIcons
              name="face-recognition"
              size={22}
              color="#D65FA1"
            />
          </View>
          <View style={styles.headCopy}>
            <Text style={styles.headTitle}>AI换脸检测</Text>
            <Text style={styles.headMeta}>单张图片鉴别</Text>
          </View>
        </View>

        <View style={styles.previewWrap}>
          {pickedImage ? (
            <Image
              source={{ uri: pickedImage.uri }}
              style={styles.previewImage}
              contentFit="cover"
            />
          ) : (
            <View style={styles.previewEmpty}>
              <MaterialCommunityIcons
                name="image-outline"
                size={28}
                color={palette.inkSoft}
              />
              <Text style={styles.previewEmptyText}>上传人脸图片后在这里显示</Text>
            </View>
          )}
        </View>

        <View style={styles.resultCard}>
          <View style={[styles.statusBadge, { backgroundColor: status.soft }]}>
            <Text style={[styles.statusBadgeText, { color: status.tint }]}>
              {status.label}
            </Text>
          </View>

          <View style={styles.metricRow}>
            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>伪造概率</Text>
              <Text style={styles.metricValue}>
                {formatPercent(result?.fake_probability)}
              </Text>
            </View>
            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>可信度</Text>
              <Text style={styles.metricValue}>
                {formatPercent(result?.confidence)}
              </Text>
            </View>
            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>人脸数量</Text>
              <Text style={styles.metricValue}>
                {result ? String(result.num_faces) : "--"}
              </Text>
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
  previewWrap: {
    height: 260,
    borderRadius: radius.md,
    overflow: "hidden",
    backgroundColor: palette.surfaceSoft,
    borderWidth: 1,
    borderColor: palette.line,
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
