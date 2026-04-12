import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AuthBackdrop, useAuth } from "@/features/auth";
import { buildDetectionSubmitFormData, detectionsApi, type PickedFile } from "@/features/detections";
import { ApiError } from "@/shared/api";
import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";

type AppendixItem = PickedFile & { key: string };

type AppendixSlot = "text" | "audio" | "image" | "video";

const TEXT_EXT = new Set([
  ".txt",
  ".pdf",
  ".md",
  ".json",
  ".csv",
  ".log",
  ".doc",
  ".docx",
]);
const AUDIO_EXT = new Set([".mp3", ".m4a", ".aac", ".wav", ".ogg", ".flac", ".opus", ".amr"]);
const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".bmp"]);
const VIDEO_EXT = new Set([".mp4", ".mov", ".webm", ".mkv", ".m4v", ".avi", ".3gp", ".mpeg", ".mpg"]);

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  if (i < 0) {
    return "";
  }
  return name.slice(i).toLowerCase();
}

function isAllowedForSlot(name: string, mime: string, slot: AppendixSlot): boolean {
  const suf = extOf(name);
  const m = mime.toLowerCase();
  if (slot === "image") {
    if (m.startsWith("image/")) {
      return true;
    }
    return suf !== "" && IMAGE_EXT.has(suf);
  }
  if (slot === "video") {
    if (m.startsWith("video/")) {
      return true;
    }
    return suf !== "" && VIDEO_EXT.has(suf);
  }
  if (slot === "audio") {
    if (m.startsWith("audio/")) {
      return suf === "" || AUDIO_EXT.has(suf);
    }
    return suf !== "" && AUDIO_EXT.has(suf);
  }
  /* text appendix */
  if (m.startsWith("image/")) {
    return false;
  }
  if (m.startsWith("video/") || m.startsWith("audio/")) {
    return false;
  }
  return suf !== "" && TEXT_EXT.has(suf);
}

function nextKey() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function isImageMime(mime: string, name: string) {
  const m = mime.toLowerCase();
  if (m.startsWith("image/")) {
    return true;
  }
  return /\.(jpg|jpeg|png|gif|webp|heic|bmp)$/i.test(name);
}

function AppendixPreviewGrid({
  items,
  onRemove,
  onImagePress,
}: {
  items: AppendixItem[];
  onRemove: (key: string) => void;
  onImagePress?: (uri: string, name: string) => void;
}) {
  if (items.length === 0) {
    return <Text style={styles.previewEmpty}>暂无文件</Text>;
  }
  return (
    <View style={styles.previewGrid}>
      {items.map((item) => (
        <View key={item.key} style={styles.previewTile}>
          {isImageMime(item.type, item.name) ? (
            <Pressable
              onPress={() => onImagePress?.(item.uri, item.name)}
              accessibilityRole="button"
              accessibilityLabel={`查看大图：${item.name}`}
            >
              <Image source={{ uri: item.uri }} style={styles.previewImage} contentFit="cover" />
            </Pressable>
          ) : (
            <View style={styles.previewIconWrap}>
              <MaterialCommunityIcons name="file-outline" size={28} color={palette.accentStrong} />
            </View>
          )}
          <Text style={styles.previewName} numberOfLines={2}>
            {item.name}
          </Text>
          <Pressable
            style={styles.previewRemove}
            onPress={() => onRemove(item.key)}
            hitSlop={6}
            accessibilityLabel={`移除 ${item.name}`}
          >
            <MaterialCommunityIcons name="close-circle" size={20} color={palette.lineStrong} />
          </Pressable>
        </View>
      ))}
    </View>
  );
}

export default function SubmitDetectionScreen() {
  const router = useRouter();
  const { token } = useAuth();

  const [textContent, setTextContent] = useState("");
  const [textFiles, setTextFiles] = useState<AppendixItem[]>([]);
  const [audioFiles, setAudioFiles] = useState<AppendixItem[]>([]);
  const [imageFiles, setImageFiles] = useState<AppendixItem[]>([]);
  const [videoFiles, setVideoFiles] = useState<AppendixItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState<string | null>(null);

  const openImagePreview = useCallback((uri: string, name: string) => {
    setPreviewUri(uri);
    setPreviewName(name);
  }, []);

  const closeImagePreview = useCallback(() => {
    setPreviewUri(null);
    setPreviewName(null);
  }, []);

  const resetForm = useCallback(() => {
    setTextContent("");
    setTextFiles([]);
    setAudioFiles([]);
    setImageFiles([]);
    setVideoFiles([]);
    closeImagePreview();
  }, [closeImagePreview]);

  const ingestPickedAssets = useCallback(
    (
      assets: { uri: string; name?: string | null; mimeType?: string | null }[],
      slot: AppendixSlot,
      setter: Dispatch<SetStateAction<AppendixItem[]>>
    ) => {
      const valid: AppendixItem[] = [];
      const bad: string[] = [];
      for (const a of assets) {
        const name = a.name ?? "file";
        const mime = a.mimeType ?? "application/octet-stream";
        if (!isAllowedForSlot(name, mime, slot)) {
          bad.push(name);
          continue;
        }
        valid.push({
          uri: a.uri,
          name,
          type: mime,
          key: nextKey(),
        });
      }
      if (bad.length > 0) {
        Alert.alert(
          "部分文件未添加",
          `以下文件不符合「${slot === "text" ? "文本" : slot === "audio" ? "音频" : slot === "image" ? "图片" : "视频"}」格式要求，已跳过：\n${bad.join("\n")}`
        );
      }
      if (valid.length > 0) {
        setter((prev) => [...prev, ...valid]);
      }
    },
    []
  );

  const pickDocumentsForSlot = useCallback(
    async (slot: Extract<AppendixSlot, "text" | "audio" | "video">, setter: Dispatch<SetStateAction<AppendixItem[]>>) => {
      if (Platform.OS === "web") {
        Alert.alert("提示", "网页端文件上传能力有限，请优先使用 iOS / Android 客户端。");
        return;
      }
      const typeOpt =
        slot === "audio"
          ? "audio/*"
          : slot === "video"
            ? "video/*"
            : undefined;
      const res = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: true,
        ...(typeOpt ? { type: typeOpt } : {}),
      });
      if (res.canceled || !res.assets?.length) {
        return;
      }
      ingestPickedAssets(res.assets, slot, setter);
    },
    [ingestPickedAssets]
  );

  const pickImagesAppend = useCallback(async () => {
    if (Platform.OS === "web") {
      Alert.alert("提示", "网页端请使用移动端上传图片。");
      return;
    }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("需要相册权限", "请在系统设置中允许访问相册。");
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      quality: 0.85,
      selectionLimit: 20,
    });
    if (res.canceled || !res.assets?.length) {
      return;
    }
    ingestPickedAssets(
      res.assets.map((a) => ({
        uri: a.uri,
        name: a.fileName ?? "image.jpg",
        mimeType: a.mimeType ?? "image/jpeg",
      })),
      "image",
      setImageFiles
    );
  }, [ingestPickedAssets]);

  const pickVideosFromGallery = useCallback(async () => {
    if (Platform.OS === "web") {
      Alert.alert("提示", "网页端请使用移动端上传视频。");
      return;
    }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("需要相册权限", "请在系统设置中允许访问相册。");
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["videos"],
      allowsMultipleSelection: true,
      selectionLimit: 10,
    });
    if (res.canceled || !res.assets?.length) {
      return;
    }
    ingestPickedAssets(
      res.assets.map((a) => ({
        uri: a.uri,
        name: a.fileName ?? "video.mp4",
        mimeType: a.mimeType ?? "video/mp4",
      })),
      "video",
      setVideoFiles
    );
  }, [ingestPickedAssets]);

  const onSubmit = useCallback(async () => {
    if (!token) {
      Alert.alert("未登录", "请先登录。");
      return;
    }
    const form = buildDetectionSubmitFormData({
      text_content: textContent,
      text_files: textFiles,
      audio_files: audioFiles,
      image_files: imageFiles,
      video_files: videoFiles,
    });
    setSubmitting(true);
    try {
      const result = await detectionsApi.submit(token, form);
      resetForm();
      Alert.alert(
        "提交成功",
        `记录号：${result.id}\n批次：${result.storage_batch_id}\n图 ${result.image_paths.length} · 音频 ${result.audio_paths.length} · 视频 ${result.video_paths.length} · 文本附件 ${result.text_paths.length}`,
        [{ text: "确定" }]
      );
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "提交失败，请稍后重试";
      Alert.alert("提交失败", message);
    } finally {
      setSubmitting(false);
    }
  }, [token, textContent, textFiles, audioFiles, imageFiles, videoFiles, resetForm]);

  return (
    <View style={styles.root}>
      <AuthBackdrop />
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <View style={styles.topRow}>
          <Pressable
            onPress={() => router.back()}
            style={styles.backBtn}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="返回"
          >
            <MaterialCommunityIcons name="chevron-left" size={26} color={palette.accentStrong} />
            <Text style={styles.backText}>返回</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>提交检测材料</Text>
          <Text style={styles.subtitle}>
            音频限 mp3、m4a、aac、wav 等；视频限 mp4、mov、webm 等；图片限 jpg、png 等；勿把图片当视频上传。附录预览为两列网格。
          </Text>

          <View style={styles.card}>
            <Text style={styles.label}>文字内容（可选）</Text>
            <TextInput
              style={styles.textArea}
              placeholder="粘贴聊天记录、短信等"
              placeholderTextColor={palette.inkSoft}
              multiline
              value={textContent}
              onChangeText={setTextContent}
              textAlignVertical="top"
            />
          </View>

          <View style={styles.card}>
            <Text style={styles.label}>附录 · 文本类（txt/pdf/doc 等）</Text>
            <Pressable
              style={styles.addBtn}
              onPress={() => void pickDocumentsForSlot("text", setTextFiles)}
            >
              <MaterialCommunityIcons name="plus-circle-outline" size={22} color={palette.accentStrong} />
              <Text style={styles.addBtnText}>添加文本 / 文档</Text>
            </Pressable>
            <AppendixPreviewGrid
              items={textFiles}
              onRemove={(key) => setTextFiles((prev) => prev.filter((x) => x.key !== key))}
              onImagePress={openImagePreview}
            />
          </View>

          <View style={styles.card}>
            <Text style={styles.label}>附录 · 图片（相册）</Text>
            <Pressable style={styles.addBtn} onPress={() => void pickImagesAppend()}>
              <MaterialCommunityIcons name="image-outline" size={22} color={palette.accentStrong} />
              <Text style={styles.addBtnText}>从相册添加图片</Text>
            </Pressable>
            <AppendixPreviewGrid
              items={imageFiles}
              onRemove={(key) => setImageFiles((prev) => prev.filter((x) => x.key !== key))}
              onImagePress={openImagePreview}
            />
          </View>

          <View style={styles.card}>
            <Text style={styles.label}>附录 · 音频（仅常见音频格式）</Text>
            <Pressable style={styles.addBtn} onPress={() => void pickDocumentsForSlot("audio", setAudioFiles)}>
              <MaterialCommunityIcons name="microphone" size={22} color={palette.accentStrong} />
              <Text style={styles.addBtnText}>选择音频文件</Text>
            </Pressable>
            <AppendixPreviewGrid
              items={audioFiles}
              onRemove={(key) => setAudioFiles((prev) => prev.filter((x) => x.key !== key))}
              onImagePress={openImagePreview}
            />
          </View>

          <View style={styles.card}>
            <Text style={styles.label}>附录 · 视频（仅视频格式）</Text>
            <Pressable style={styles.addBtn} onPress={() => void pickVideosFromGallery()}>
              <MaterialCommunityIcons name="video-outline" size={22} color={palette.accentStrong} />
              <Text style={styles.addBtnText}>从相册添加视频</Text>
            </Pressable>
            <Pressable
              style={styles.addBtnSecondary}
              onPress={() => void pickDocumentsForSlot("video", setVideoFiles)}
            >
              <MaterialCommunityIcons name="folder-outline" size={20} color={palette.accentStrong} />
              <Text style={styles.addBtnTextSecondary}>从文件管理选择视频</Text>
            </Pressable>
            <AppendixPreviewGrid
              items={videoFiles}
              onRemove={(key) => setVideoFiles((prev) => prev.filter((x) => x.key !== key))}
              onImagePress={openImagePreview}
            />
          </View>

          <Pressable
            style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
            onPress={() => void onSubmit()}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator color={palette.inkInverse} />
            ) : (
              <Text style={styles.submitBtnText}>提交到服务端</Text>
            )}
          </Pressable>
        </ScrollView>
      </SafeAreaView>

      <Modal
        visible={previewUri !== null}
        animationType="fade"
        presentationStyle="fullScreen"
        onRequestClose={closeImagePreview}
      >
        <View style={styles.lightboxRoot}>
          <SafeAreaView style={styles.lightboxSafe} edges={["top", "bottom"]}>
            <View style={styles.lightboxHeader}>
              <Pressable
                onPress={closeImagePreview}
                style={styles.lightboxCloseBtn}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="关闭大图"
              >
                <MaterialCommunityIcons name="close" size={28} color={palette.white} />
              </Pressable>
              <Text style={styles.lightboxTitle} numberOfLines={1}>
                {previewName ?? ""}
              </Text>
            </View>
            <View style={styles.lightboxBody}>
              {previewUri ? (
                <Image
                  source={{ uri: previewUri }}
                  style={styles.lightboxImage}
                  contentFit="contain"
                  transition={200}
                />
              ) : null}
            </View>
          </SafeAreaView>
        </View>
      </Modal>
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
  topRow: {
    paddingHorizontal: 8,
    paddingTop: 4,
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    paddingVertical: 6,
    paddingHorizontal: 8,
    gap: 2,
  },
  backText: {
    color: palette.accentStrong,
    fontSize: 16,
    fontWeight: "600",
    fontFamily: fontFamily.body,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 32,
    gap: 14,
  },
  title: {
    color: palette.ink,
    fontSize: 22,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  subtitle: {
    color: palette.inkSoft,
    fontSize: 13,
    lineHeight: 19,
    fontFamily: fontFamily.body,
    marginTop: -6,
  },
  card: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: 16,
    borderWidth: 1,
    borderColor: palette.line,
    gap: 10,
    ...panelShadow,
  },
  label: {
    color: palette.ink,
    fontSize: 14,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  textArea: {
    minHeight: 88,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: palette.ink,
    fontSize: 15,
    fontFamily: fontFamily.body,
    backgroundColor: palette.surfaceSoft,
  },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: radius.md,
    backgroundColor: palette.accentSoft,
    borderWidth: 1,
    borderColor: palette.line,
  },
  addBtnSecondary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radius.md,
    backgroundColor: palette.surfaceSoft,
    borderWidth: 1,
    borderColor: palette.line,
  },
  addBtnText: {
    color: palette.accentStrong,
    fontSize: 14,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  addBtnTextSecondary: {
    color: palette.accentStrong,
    fontSize: 13,
    fontWeight: "600",
    fontFamily: fontFamily.body,
  },
  previewEmpty: {
    color: palette.inkSoft,
    fontSize: 13,
    fontFamily: fontFamily.body,
  },
  previewGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    width: "100%",
    paddingVertical: 4,
  },
  previewTile: {
    width: "48%",
    marginBottom: 10,
    position: "relative",
  },
  previewImage: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: radius.md,
    backgroundColor: palette.surfaceSoft,
    borderWidth: 1,
    borderColor: palette.line,
  },
  previewIconWrap: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: radius.md,
    backgroundColor: palette.surfaceSoft,
    borderWidth: 1,
    borderColor: palette.line,
    justifyContent: "center",
    alignItems: "center",
  },
  previewName: {
    marginTop: 4,
    fontSize: 11,
    lineHeight: 14,
    color: palette.inkSoft,
    fontFamily: fontFamily.body,
  },
  previewRemove: {
    position: "absolute",
    top: -4,
    right: -4,
    backgroundColor: palette.surface,
    borderRadius: 12,
  },
  submitBtn: {
    marginTop: 8,
    backgroundColor: palette.accent,
    paddingVertical: 16,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
    ...panelShadow,
  },
  submitBtnDisabled: {
    opacity: 0.7,
  },
  submitBtnText: {
    color: palette.inkInverse,
    fontSize: 16,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  lightboxRoot: {
    flex: 1,
    backgroundColor: "#0a0a0a",
  },
  lightboxSafe: {
    flex: 1,
  },
  lightboxHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  lightboxCloseBtn: {
    padding: 4,
  },
  lightboxTitle: {
    flex: 1,
    color: palette.white,
    fontSize: 15,
    fontWeight: "600",
    fontFamily: fontFamily.body,
  },
  lightboxBody: {
    flex: 1,
    width: "100%",
  },
  lightboxImage: {
    flex: 1,
    width: "100%",
  },
});
