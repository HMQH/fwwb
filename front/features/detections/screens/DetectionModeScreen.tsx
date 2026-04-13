import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Animated, { FadeInDown, FadeInUp, LinearTransition } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "@/features/auth";
import { ApiError } from "@/shared/api";
import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";
import { useReduceMotionEnabled } from "@/shared/useReduceMotionEnabled";

import { buildDetectionSubmitFormData, detectionsApi } from "../api";
import type { DetectionMode, PickedFile } from "../types";

type AppendixItem = PickedFile & { key: string };
type AppendixSlot = "text" | "audio" | "image" | "video";

const TEXT_EXT = new Set([".txt", ".pdf", ".md", ".json", ".csv", ".log", ".doc", ".docx"]);
const AUDIO_EXT = new Set([".mp3", ".m4a", ".aac", ".wav", ".ogg", ".flac", ".opus", ".amr"]);
const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".bmp"]);
const VIDEO_EXT = new Set([".mp4", ".mov", ".webm", ".mkv", ".m4v", ".avi", ".3gp", ".mpeg", ".mpg"]);

const modeConfig: Record<
  DetectionMode,
  {
    title: string;
    subtitle: string;
    icon: keyof typeof MaterialCommunityIcons.glyphMap;
    fields: {
      text: boolean;
      textFiles: boolean;
      image: boolean;
      video: boolean;
      audio: boolean;
    };
    placeholder: string;
  }
> = {
  text: {
    title: "文本检测",
    subtitle: "聊天记录、短信、链接内容",
    icon: "message-text-outline",
    fields: {
      text: true,
      textFiles: true,
      image: false,
      video: false,
      audio: false,
    },
    placeholder: "输入或粘贴需要识别的聊天、短信或链接描述",
  },
  visual: {
    title: "图片/视频检测",
    subtitle: "截图、二维码页面、海报、视频片段",
    icon: "image-search-outline",
    fields: {
      text: false,
      textFiles: false,
      image: true,
      video: true,
      audio: false,
    },
    placeholder: "",
  },
  audio: {
    title: "音频检测",
    subtitle: "录音文件、语音消息、通话片段",
    icon: "microphone-outline",
    fields: {
      text: false,
      textFiles: false,
      image: false,
      video: false,
      audio: true,
    },
    placeholder: "",
  },
  mixed: {
    title: "混合检测",
    subtitle: "文本、图片、音频、视频联合判断",
    icon: "layers-triple-outline",
    fields: {
      text: true,
      textFiles: false,
      image: true,
      video: true,
      audio: true,
    },
    placeholder: "补充核心聊天内容，有助于系统联合判断",
  },
};

function nextKey() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function extOf(name: string) {
  const index = name.lastIndexOf(".");
  return index < 0 ? "" : name.slice(index).toLowerCase();
}

function isAllowedForSlot(name: string, mime: string, slot: AppendixSlot) {
  const suffix = extOf(name);
  const mimeType = mime.toLowerCase();

  if (slot === "image") {
    return mimeType.startsWith("image/") || (suffix !== "" && IMAGE_EXT.has(suffix));
  }

  if (slot === "video") {
    return mimeType.startsWith("video/") || (suffix !== "" && VIDEO_EXT.has(suffix));
  }

  if (slot === "audio") {
    return mimeType.startsWith("audio/") || (suffix !== "" && AUDIO_EXT.has(suffix));
  }

  if (mimeType.startsWith("image/") || mimeType.startsWith("video/") || mimeType.startsWith("audio/")) {
    return false;
  }

  return suffix !== "" && TEXT_EXT.has(suffix);
}

function isImageFile(mime: string, name: string) {
  return mime.toLowerCase().startsWith("image/") || /\.(jpg|jpeg|png|gif|webp|heic|bmp)$/i.test(name);
}

function DetectionPreviewGrid({
  items,
  onRemove,
}: {
  items: AppendixItem[];
  onRemove: (key: string) => void;
}) {
  if (items.length === 0) {
    return null;
  }

  return (
    <View style={styles.previewGrid}>
      {items.map((item) => (
        <Animated.View key={item.key} layout={LinearTransition.duration(220)} style={styles.previewTile}>
          {isImageFile(item.type, item.name) ? (
            <Image source={{ uri: item.uri }} style={styles.previewImage} contentFit="cover" />
          ) : (
            <View style={styles.previewFileIcon}>
              <MaterialCommunityIcons name="file-outline" size={18} color={palette.accentStrong} />
            </View>
          )}

          <Text style={styles.previewName} numberOfLines={2}>
            {item.name}
          </Text>

          <Pressable
            style={styles.previewRemove}
            onPress={() => onRemove(item.key)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`移除 ${item.name}`}
          >
            <MaterialCommunityIcons name="close-circle" size={18} color={palette.lineStrong} />
          </Pressable>
        </Animated.View>
      ))}
    </View>
  );
}

function UploadButton({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={({ pressed }) => [styles.uploadButton, pressed && styles.uploadButtonPressed]} onPress={onPress}>
      <View style={styles.uploadIconWrap}>
        <MaterialCommunityIcons name={icon} size={18} color={palette.accentStrong} />
      </View>
      <Text style={styles.uploadButtonText}>{label}</Text>
      <MaterialCommunityIcons name="chevron-right" size={16} color={palette.lineStrong} />
    </Pressable>
  );
}

export function DetectionModeScreen({ mode }: { mode: DetectionMode }) {
  const router = useRouter();
  const reduceMotion = useReduceMotionEnabled();
  const { token } = useAuth();
  const config = modeConfig[mode];

  const [textContent, setTextContent] = useState("");
  const [textFiles, setTextFiles] = useState<AppendixItem[]>([]);
  const [audioFiles, setAudioFiles] = useState<AppendixItem[]>([]);
  const [imageFiles, setImageFiles] = useState<AppendixItem[]>([]);
  const [videoFiles, setVideoFiles] = useState<AppendixItem[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const cardEnterBase = reduceMotion ? undefined : FadeInUp.duration(420);

  const ingestAssets = useCallback(
    (
      assets: { uri: string; name?: string | null; mimeType?: string | null }[],
      slot: AppendixSlot,
      setter: Dispatch<SetStateAction<AppendixItem[]>>
    ) => {
      const valid: AppendixItem[] = [];
      const invalid: string[] = [];

      for (const asset of assets) {
        const name = asset.name ?? "file";
        const mimeType = asset.mimeType ?? "application/octet-stream";

        if (!isAllowedForSlot(name, mimeType, slot)) {
          invalid.push(name);
          continue;
        }

        valid.push({
          uri: asset.uri,
          name,
          type: mimeType,
          key: nextKey(),
        });
      }

      if (invalid.length > 0) {
        Alert.alert("部分文件未添加", `以下文件不符合当前入口要求：\n${invalid.join("\n")}`);
      }

      if (valid.length > 0) {
        setter((prev) => [...prev, ...valid]);
      }
    },
    []
  );

  const pickDocumentsForSlot = useCallback(
    async (
      slot: Extract<AppendixSlot, "text" | "audio" | "video">,
      setter: Dispatch<SetStateAction<AppendixItem[]>>
    ) => {
      if (Platform.OS === "web") {
        Alert.alert("当前平台受限", "请优先在手机端选择文件。");
        return;
      }

      const typeOption = slot === "audio" ? "audio/*" : slot === "video" ? "video/*" : undefined;
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: true,
        ...(typeOption ? { type: typeOption } : {}),
      });

      if (result.canceled || !result.assets.length) {
        return;
      }

      ingestAssets(result.assets, slot, setter);
    },
    [ingestAssets]
  );

  const pickImages = useCallback(async () => {
    if (Platform.OS === "web") {
      Alert.alert("当前平台受限", "请优先在手机端选择图片。");
      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("需要相册权限", "请在系统设置中允许访问相册。");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      selectionLimit: 20,
      quality: 0.84,
    });

    if (result.canceled || !result.assets.length) {
      return;
    }

    ingestAssets(
      result.assets.map((asset) => ({
        uri: asset.uri,
        name: asset.fileName ?? "image.jpg",
        mimeType: asset.mimeType ?? "image/jpeg",
      })),
      "image",
      setImageFiles
    );
  }, [ingestAssets]);

  const pickVideos = useCallback(async () => {
    if (Platform.OS === "web") {
      Alert.alert("当前平台受限", "请优先在手机端选择视频。");
      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("需要相册权限", "请在系统设置中允许访问相册。");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["videos"],
      allowsMultipleSelection: true,
      selectionLimit: 10,
    });

    if (result.canceled || !result.assets.length) {
      return;
    }

    ingestAssets(
      result.assets.map((asset) => ({
        uri: asset.uri,
        name: asset.fileName ?? "video.mp4",
        mimeType: asset.mimeType ?? "video/mp4",
      })),
      "video",
      setVideoFiles
    );
  }, [ingestAssets]);

  const resetForm = useCallback(() => {
    setTextContent("");
    setTextFiles([]);
    setAudioFiles([]);
    setImageFiles([]);
    setVideoFiles([]);
  }, []);

  const hasPayload = useMemo(
    () =>
      Boolean(textContent.trim()) ||
      textFiles.length > 0 ||
      audioFiles.length > 0 ||
      imageFiles.length > 0 ||
      videoFiles.length > 0,
    [audioFiles.length, imageFiles.length, textContent, textFiles.length, videoFiles.length]
  );

  const handleSubmit = useCallback(async () => {
    if (!token) {
      Alert.alert("未登录", "请先登录。");
      return;
    }

    if (!hasPayload) {
      Alert.alert("缺少内容", "请至少添加一项检测内容。");
      return;
    }

    const formData = buildDetectionSubmitFormData({
      text_content: textContent,
      text_files: textFiles,
      audio_files: audioFiles,
      image_files: imageFiles,
      video_files: videoFiles,
    });

    setSubmitting(true);

    try {
      await detectionsApi.submit(token, formData);
      resetForm();
      Alert.alert("提交成功", "材料已发送，后续可继续补充识别结果页。");
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "提交失败，请稍后重试。";
      Alert.alert("提交失败", message);
    } finally {
      setSubmitting(false);
    }
  }, [audioFiles, hasPayload, imageFiles, resetForm, textContent, textFiles, token, videoFiles]);

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Animated.View entering={reduceMotion ? undefined : FadeInDown.duration(380)} style={styles.topRow}>
            <Pressable
              style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
              onPress={() => router.back()}
            >
              <MaterialCommunityIcons name="chevron-left" size={18} color={palette.accentStrong} />
              <Text style={styles.backButtonText}>返回</Text>
            </Pressable>
          </Animated.View>

          <Animated.View
            entering={cardEnterBase}
            style={styles.heroCard}
          >
            <View style={styles.heroIconWrap}>
              <MaterialCommunityIcons name={config.icon} size={18} color={palette.accentStrong} />
            </View>
            <View style={styles.heroCopy}>
              <Text style={styles.heroTitle}>{config.title}</Text>
              <Text style={styles.heroSubtitle}>{config.subtitle}</Text>
            </View>
          </Animated.View>

          {config.fields.text ? (
            <Animated.View
              entering={cardEnterBase?.delay(80)}
              style={styles.card}
            >
              <Text style={styles.cardTitle}>输入内容</Text>
              <TextInput
                style={styles.textArea}
                placeholder={config.placeholder}
                placeholderTextColor={palette.inkSoft}
                value={textContent}
                onChangeText={setTextContent}
                multiline
                textAlignVertical="top"
              />
            </Animated.View>
          ) : null}

          {config.fields.textFiles ? (
            <Animated.View
              entering={cardEnterBase?.delay(120)}
              style={styles.card}
            >
              <Text style={styles.cardTitle}>文本附件</Text>
              <UploadButton icon="file-document-outline" label="选择文档" onPress={() => void pickDocumentsForSlot("text", setTextFiles)} />
              <DetectionPreviewGrid
                items={textFiles}
                onRemove={(key) => setTextFiles((prev) => prev.filter((item) => item.key !== key))}
              />
            </Animated.View>
          ) : null}

          {config.fields.image ? (
            <Animated.View
              entering={cardEnterBase?.delay(160)}
              style={styles.card}
            >
              <Text style={styles.cardTitle}>图片材料</Text>
              <UploadButton icon="image-outline" label="从相册添加图片" onPress={() => void pickImages()} />
              <DetectionPreviewGrid
                items={imageFiles}
                onRemove={(key) => setImageFiles((prev) => prev.filter((item) => item.key !== key))}
              />
            </Animated.View>
          ) : null}

          {config.fields.video ? (
            <Animated.View
              entering={cardEnterBase?.delay(220)}
              style={styles.card}
            >
              <Text style={styles.cardTitle}>视频材料</Text>
              <UploadButton icon="video-outline" label="从相册添加视频" onPress={() => void pickVideos()} />
              <UploadButton icon="folder-outline" label="从文件中选择视频" onPress={() => void pickDocumentsForSlot("video", setVideoFiles)} />
              <DetectionPreviewGrid
                items={videoFiles}
                onRemove={(key) => setVideoFiles((prev) => prev.filter((item) => item.key !== key))}
              />
            </Animated.View>
          ) : null}

          {config.fields.audio ? (
            <Animated.View
              entering={cardEnterBase?.delay(280)}
              style={styles.card}
            >
              <Text style={styles.cardTitle}>音频材料</Text>
              <UploadButton icon="microphone-outline" label="选择音频文件" onPress={() => void pickDocumentsForSlot("audio", setAudioFiles)} />
              <DetectionPreviewGrid
                items={audioFiles}
                onRemove={(key) => setAudioFiles((prev) => prev.filter((item) => item.key !== key))}
              />
            </Animated.View>
          ) : null}

          <Animated.View entering={cardEnterBase?.delay(340)} style={styles.bottomWrap}>
            <Pressable
              style={({ pressed }) => [
                styles.submitButton,
                pressed && !submitting && styles.submitButtonPressed,
                submitting && styles.submitButtonDisabled,
              ]}
              onPress={() => void handleSubmit()}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator size="small" color={palette.inkInverse} />
              ) : (
                <>
                  <Text style={styles.submitButtonText}>开始检测</Text>
                  <MaterialCommunityIcons name="arrow-right" size={16} color={palette.inkInverse} />
                </>
              )}
            </Pressable>
          </Animated.View>
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
  topRow: {
    alignItems: "flex-start",
  },
  backButton: {
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
  backButtonPressed: {
    opacity: 0.88,
  },
  backButtonText: {
    color: palette.accentStrong,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  heroCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 26,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 16,
    paddingVertical: 16,
    ...panelShadow,
  },
  heroIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 14,
    backgroundColor: palette.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  heroCopy: {
    flex: 1,
    gap: 2,
  },
  heroTitle: {
    color: palette.ink,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  heroSubtitle: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  card: {
    borderRadius: 26,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 12,
    ...panelShadow,
  },
  cardTitle: {
    color: palette.ink,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  textArea: {
    minHeight: 168,
    borderRadius: 20,
    backgroundColor: palette.surfaceSoft,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 14,
    lineHeight: 21,
    color: palette.ink,
    fontFamily: fontFamily.body,
  },
  uploadButton: {
    minHeight: 48,
    borderRadius: 18,
    backgroundColor: palette.surfaceSoft,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  uploadButtonPressed: {
    opacity: 0.9,
  },
  uploadIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 12,
    backgroundColor: palette.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  uploadButtonText: {
    flex: 1,
    color: palette.ink,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  previewGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  previewTile: {
    width: "47.5%",
    borderRadius: 18,
    backgroundColor: palette.surfaceSoft,
    borderWidth: 1,
    borderColor: palette.line,
    padding: 10,
    gap: 8,
  },
  previewImage: {
    width: "100%",
    aspectRatio: 1.2,
    borderRadius: 14,
    backgroundColor: palette.surfaceStrong,
  },
  previewFileIcon: {
    width: "100%",
    aspectRatio: 1.2,
    borderRadius: 14,
    backgroundColor: palette.surfaceStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  previewName: {
    color: palette.ink,
    fontSize: 12,
    lineHeight: 17,
    fontFamily: fontFamily.body,
    paddingRight: 20,
  },
  previewRemove: {
    position: "absolute",
    top: 8,
    right: 8,
  },
  bottomWrap: {
    paddingTop: 4,
  },
  submitButton: {
    minHeight: 54,
    borderRadius: 22,
    backgroundColor: palette.accentStrong,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    ...panelShadow,
  },
  submitButtonPressed: {
    opacity: 0.92,
  },
  submitButtonDisabled: {
    opacity: 0.8,
  },
  submitButtonText: {
    color: palette.inkInverse,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
});
