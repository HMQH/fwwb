import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
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
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "@/features/auth";
import { ApiError } from "@/shared/api";
import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";

import { buildDetectionSubmitFormData, detectionsApi } from "../api";
import { DetectionResultCard } from "../components/DetectionResultCard";
import { EvidenceListCard } from "../components/EvidenceListCard";
import type { DetectionJob, DetectionMode, DetectionSubmissionDetail, PickedFile } from "../types";

type AppendixSlot = "text" | "audio" | "image" | "video";
type AppendixItem = PickedFile & { key: string };

const modeConfig: Record<
  DetectionMode,
  {
    title: string;
    subtitle: string;
    icon: keyof typeof MaterialCommunityIcons.glyphMap;
    allow: { text: boolean; textFiles: boolean; image: boolean; video: boolean; audio: boolean };
  }
> = {
  text: {
    title: "文本检测",
    subtitle: "适合聊天记录、短信、售后对话、可复制文本。",
    icon: "message-text-outline",
    allow: { text: true, textFiles: true, image: false, video: false, audio: false },
  },
  visual: {
    title: "图像 / 视频检测",
    subtitle: "这一版仍以文本 RAG 为主，可先留存截图与视频证据。",
    icon: "image-search-outline",
    allow: { text: true, textFiles: false, image: true, video: true, audio: false },
  },
  audio: {
    title: "音频检测",
    subtitle: "优先补充通话文本或文字摘要，便于进入文本分析链路。",
    icon: "microphone-outline",
    allow: { text: true, textFiles: false, image: false, video: false, audio: true },
  },
  mixed: {
    title: "混合检测",
    subtitle: "文本为主、附件为辅：先判定话术，再保留其他证据。",
    icon: "layers-triple-outline",
    allow: { text: true, textFiles: true, image: true, video: true, audio: true },
  },
};

const nextKey = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const extOf = (name: string) => {
  const index = name.lastIndexOf(".");
  return index < 0 ? "" : name.slice(index).toLowerCase();
};

const TEXT_EXT = new Set([".txt", ".md", ".json", ".csv", ".log", ".html", ".htm", ".pdf", ".doc", ".docx"]);
const AUDIO_EXT = new Set([".mp3", ".m4a", ".aac", ".wav", ".ogg", ".flac", ".opus", ".amr"]);
const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".bmp"]);
const VIDEO_EXT = new Set([".mp4", ".mov", ".webm", ".mkv", ".avi", ".m4v", ".3gp"]);

function isAllowedForSlot(name: string, mime: string, slot: AppendixSlot) {
  const suffix = extOf(name);
  const mimeType = mime.toLowerCase();

  if (slot === "image") {
    return mimeType.startsWith("image/") || IMAGE_EXT.has(suffix);
  }
  if (slot === "video") {
    return mimeType.startsWith("video/") || VIDEO_EXT.has(suffix);
  }
  if (slot === "audio") {
    return mimeType.startsWith("audio/") || AUDIO_EXT.has(suffix);
  }
  if (slot === "text") {
    if (mimeType.startsWith("image/") || mimeType.startsWith("video/") || mimeType.startsWith("audio/")) {
      return false;
    }
    return TEXT_EXT.has(suffix);
  }
  return false;
}

function isImageFile(file: PickedFile) {
  return file.type.toLowerCase().startsWith("image/") || IMAGE_EXT.has(extOf(file.name));
}

function PreviewGrid({
  title,
  items,
  onRemove,
}: {
  title: string;
  items: AppendixItem[];
  onRemove: (key: string) => void;
}) {
  return (
    <View style={styles.previewSection}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {items.length ? (
        <View style={styles.previewGrid}>
          {items.map((item) => (
            <View key={item.key} style={styles.previewTile}>
              {isImageFile(item) ? (
                <Image source={{ uri: item.uri }} style={styles.previewImage} contentFit="cover" />
              ) : (
                <View style={styles.previewFile}>
                  <MaterialCommunityIcons name="file-outline" size={22} color={palette.accentStrong} />
                </View>
              )}
              <Text style={styles.previewName} numberOfLines={2}>
                {item.name}
              </Text>
              <Pressable style={({ pressed }) => [styles.removeChip, pressed && styles.buttonPressed]} onPress={() => onRemove(item.key)}>
                <MaterialCommunityIcons name="close" size={14} color={palette.ink} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.helperText}>还没有添加文件。</Text>
      )}
    </View>
  );
}

export function DetectionModeScreen({ mode }: { mode: DetectionMode }) {
  const router = useRouter();
  const { token } = useAuth();
  const config = modeConfig[mode];

  const [textContent, setTextContent] = useState("");
  const [textFiles, setTextFiles] = useState<AppendixItem[]>([]);
  const [audioFiles, setAudioFiles] = useState<AppendixItem[]>([]);
  const [imageFiles, setImageFiles] = useState<AppendixItem[]>([]);
  const [videoFiles, setVideoFiles] = useState<AppendixItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [activeJob, setActiveJob] = useState<DetectionJob | null>(null);
  const [detail, setDetail] = useState<DetectionSubmissionDetail | null>(null);

  const activeSubmissionId = activeJob?.submission_id ?? detail?.submission.id ?? null;
  const currentResult = activeJob?.result ?? detail?.latest_result ?? null;

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
        valid.push({ uri: asset.uri, name, type: mimeType, key: nextKey() });
      }
      if (invalid.length) {
        Alert.alert("部分文件未添加", `以下文件与当前入口不匹配：\n${invalid.join("\n")}`);
      }
      if (valid.length) {
        setter((prev) => [...prev, ...valid]);
      }
    },
    []
  );

  const pickDocumentsForSlot = useCallback(
    async (slot: Extract<AppendixSlot, "text" | "audio" | "video">, setter: Dispatch<SetStateAction<AppendixItem[]>>) => {
      if (Platform.OS === "web") {
        Alert.alert("当前平台受限", "请优先在手机端选择文件。");
        return;
      }
      const typeOption = slot === "audio" ? "audio/*" : slot === "video" ? "video/*" : "*/*";
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: true,
        type: typeOption,
      });
      if (!result.canceled && result.assets.length) {
        ingestAssets(result.assets, slot, setter);
      }
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
      selectionLimit: 12,
      quality: 0.9,
    });
    if (!result.canceled && result.assets.length) {
      ingestAssets(
        result.assets.map((asset) => ({
          uri: asset.uri,
          name: asset.fileName ?? "image.jpg",
          mimeType: asset.mimeType ?? "image/jpeg",
        })),
        "image",
        setImageFiles
      );
    }
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
      selectionLimit: 8,
    });
    if (!result.canceled && result.assets.length) {
      ingestAssets(
        result.assets.map((asset) => ({
          uri: asset.uri,
          name: asset.fileName ?? "video.mp4",
          mimeType: asset.mimeType ?? "video/mp4",
        })),
        "video",
        setVideoFiles
      );
    }
  }, [ingestAssets]);

  const hasPayload = useMemo(() => {
    return Boolean(textContent.trim()) || textFiles.length > 0 || audioFiles.length > 0 || imageFiles.length > 0 || videoFiles.length > 0;
  }, [audioFiles.length, imageFiles.length, textContent, textFiles.length, videoFiles.length]);

  const resetForm = useCallback(() => {
    setTextContent("");
    setTextFiles([]);
    setAudioFiles([]);
    setImageFiles([]);
    setVideoFiles([]);
  }, []);

  const openDetail = useCallback(() => {
    if (!activeSubmissionId) {
      return;
    }
    router.push({ pathname: "/records/[id]", params: { id: activeSubmissionId } });
  }, [activeSubmissionId, router]);

  const refreshDetail = useCallback(async () => {
    if (!token || !activeSubmissionId) {
      return;
    }
    try {
      const detailResponse = await detectionsApi.getSubmission(token, activeSubmissionId);
      setDetail(detailResponse);
    } catch {
      // 忽略静默刷新失败，主状态仍以 job 轮询为准。
    }
  }, [activeSubmissionId, token]);

  const handleSubmit = useCallback(async () => {
    if (!token) {
      Alert.alert("未登录", "请先登录后再提交检测。");
      return;
    }
    if (!hasPayload) {
      Alert.alert("缺少内容", "请至少输入一段文本或添加一个附件。");
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
      const response = await detectionsApi.submit(token, formData);
      setActiveJob(response.job);
      setDetail({
        submission: response.submission,
        latest_job: response.job,
        latest_result: response.job.result,
        content_preview: response.submission.text_content?.slice(0, 88) ?? null,
      });
      resetForm();
      Alert.alert("已加入检测队列", "系统已开始进行规则分析、黑白样本检索与模型判定。", [
        { text: "继续留在当前页" },
        {
          text: "查看详情",
          onPress: () =>
            router.push({ pathname: "/records/[id]", params: { id: response.submission.id } }),
        },
      ]);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "提交失败，请稍后重试。";
      Alert.alert("提交失败", message);
    } finally {
      setSubmitting(false);
    }
  }, [audioFiles, hasPayload, imageFiles, openDetail, resetForm, textContent, textFiles, token, videoFiles]);

  const handleRerun = useCallback(async () => {
    if (!token || !activeSubmissionId) {
      return;
    }
    try {
      const job = await detectionsApi.rerun(token, activeSubmissionId);
      setActiveJob(job);
      setDetail((prev) => (prev ? { ...prev, latest_job: job, latest_result: job.result } : prev));
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "重试失败，请稍后再试。";
      Alert.alert("无法重跑", message);
    }
  }, [activeSubmissionId, token]);

  useEffect(() => {
    if (!token || !activeJob) {
      return;
    }
    if (activeJob.status !== "pending" && activeJob.status !== "running") {
      if (activeJob.status === "completed") {
        void refreshDetail();
      }
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const latestJob = await detectionsApi.getJob(token, activeJob.id);
        setActiveJob(latestJob);
        setDetail((prev) =>
          prev
            ? {
                ...prev,
                latest_job: latestJob,
                latest_result: latestJob.result,
              }
            : prev
        );
        if (latestJob.status === "completed") {
          void refreshDetail();
        }
      } catch {
        // 下一轮轮询继续尝试
      }
    }, 2500);

    return () => clearTimeout(timer);
  }, [activeJob, refreshDetail, token]);

  const attachmentCount = textFiles.length + audioFiles.length + imageFiles.length + videoFiles.length;

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.heroCard}>
            <View style={styles.heroRow}>
              <View style={styles.heroIconWrap}>
                <MaterialCommunityIcons name={config.icon} size={24} color={palette.accentStrong} />
              </View>
              <View style={styles.heroCopy}>
                <Text style={styles.eyebrow}>反诈工作台</Text>
                <Text style={styles.heroTitle}>{config.title}</Text>
                <Text style={styles.heroSubtitle}>{config.subtitle}</Text>
              </View>
            </View>

            <View style={styles.heroMetaRow}>
              <View style={styles.metaPill}>
                <Text style={styles.metaPillText}>规则预判</Text>
              </View>
              <View style={styles.metaPill}>
                <Text style={styles.metaPillText}>黑白对比 RAG</Text>
              </View>
              <View style={styles.metaPill}>
                <Text style={styles.metaPillText}>结构化结论</Text>
              </View>
            </View>
          </View>

          {config.allow.text ? (
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>核心文本</Text>
              <Text style={styles.sectionHint}>尽量贴入关键对话原文，系统会优先基于文本做真实 RAG 检索。</Text>
              <TextInput
                style={styles.textArea}
                placeholder="例如：对方要求你点击链接、下载 APP、转账、提供验证码、共享屏幕……"
                placeholderTextColor={palette.inkSoft}
                value={textContent}
                onChangeText={setTextContent}
                multiline
                textAlignVertical="top"
              />
            </View>
          ) : null}

          {config.allow.textFiles ? (
            <View style={styles.sectionCard}>
              <View style={styles.sectionHeaderRow}>
                <View style={styles.sectionHeaderCopy}>
                  <Text style={styles.sectionTitle}>文本附件</Text>
                  <Text style={styles.sectionHint}>适合 txt / md / csv / json / 聊天导出文件；可与手动输入一起提交。</Text>
                </View>
                <Pressable style={({ pressed }) => [styles.addButton, pressed && styles.buttonPressed]} onPress={() => void pickDocumentsForSlot("text", setTextFiles)}>
                  <MaterialCommunityIcons name="plus" size={16} color={palette.accentStrong} />
                  <Text style={styles.addButtonText}>添加</Text>
                </Pressable>
              </View>
              <PreviewGrid title="已添加文本文件" items={textFiles} onRemove={(key) => setTextFiles((prev) => prev.filter((item) => item.key !== key))} />
            </View>
          ) : null}

          {config.allow.image ? (
            <View style={styles.sectionCard}>
              <View style={styles.sectionHeaderRow}>
                <View style={styles.sectionHeaderCopy}>
                  <Text style={styles.sectionTitle}>图片证据</Text>
                  <Text style={styles.sectionHint}>截图、二维码、页面信息会一起存档，便于后续复查。</Text>
                </View>
                <Pressable style={({ pressed }) => [styles.addButton, pressed && styles.buttonPressed]} onPress={() => void pickImages()}>
                  <MaterialCommunityIcons name="image-plus-outline" size={16} color={palette.accentStrong} />
                  <Text style={styles.addButtonText}>相册</Text>
                </Pressable>
              </View>
              <PreviewGrid title="已添加图片" items={imageFiles} onRemove={(key) => setImageFiles((prev) => prev.filter((item) => item.key !== key))} />
            </View>
          ) : null}

          {config.allow.video ? (
            <View style={styles.sectionCard}>
              <View style={styles.sectionHeaderRow}>
                <View style={styles.sectionHeaderCopy}>
                  <Text style={styles.sectionTitle}>视频证据</Text>
                  <Text style={styles.sectionHint}>录屏、短视频等将保留在记录详情中。</Text>
                </View>
                <View style={styles.inlineButtonRow}>
                  <Pressable style={({ pressed }) => [styles.addButton, pressed && styles.buttonPressed]} onPress={() => void pickVideos()}>
                    <MaterialCommunityIcons name="video-plus-outline" size={16} color={palette.accentStrong} />
                    <Text style={styles.addButtonText}>相册</Text>
                  </Pressable>
                  <Pressable style={({ pressed }) => [styles.addButton, pressed && styles.buttonPressed]} onPress={() => void pickDocumentsForSlot("video", setVideoFiles)}>
                    <MaterialCommunityIcons name="folder-plus-outline" size={16} color={palette.accentStrong} />
                    <Text style={styles.addButtonText}>文件</Text>
                  </Pressable>
                </View>
              </View>
              <PreviewGrid title="已添加视频" items={videoFiles} onRemove={(key) => setVideoFiles((prev) => prev.filter((item) => item.key !== key))} />
            </View>
          ) : null}

          {config.allow.audio ? (
            <View style={styles.sectionCard}>
              <View style={styles.sectionHeaderRow}>
                <View style={styles.sectionHeaderCopy}>
                  <Text style={styles.sectionTitle}>音频证据</Text>
                  <Text style={styles.sectionHint}>当前仍建议同时补一段文字摘要，效果会明显更好。</Text>
                </View>
                <Pressable style={({ pressed }) => [styles.addButton, pressed && styles.buttonPressed]} onPress={() => void pickDocumentsForSlot("audio", setAudioFiles)}>
                  <MaterialCommunityIcons name="microphone-plus" size={16} color={palette.accentStrong} />
                  <Text style={styles.addButtonText}>添加</Text>
                </Pressable>
              </View>
              <PreviewGrid title="已添加音频" items={audioFiles} onRemove={(key) => setAudioFiles((prev) => prev.filter((item) => item.key !== key))} />
            </View>
          ) : null}

          <View style={styles.commandCard}>
            <View style={styles.commandCopy}>
              <Text style={styles.commandTitle}>
                {hasPayload ? `准备提交 ${attachmentCount + (textContent.trim() ? 1 : 0)} 项检测材料` : "先补充至少一段文本或一个附件"}
              </Text>
              <Text style={styles.commandText}>
                系统会先跑规则与黑白样本对比检索，再交给模型生成结构化结论与建议。
              </Text>
            </View>
            <Pressable style={({ pressed }) => [styles.submitButton, pressed && !submitting && styles.buttonPressed, submitting && styles.submitDisabled]} onPress={() => void handleSubmit()} disabled={submitting}>
              {submitting ? (
                <ActivityIndicator size="small" color={palette.inkInverse} />
              ) : (
                <>
                  <Text style={styles.submitButtonText}>开始检测</Text>
                  <MaterialCommunityIcons name="arrow-right" size={16} color={palette.inkInverse} />
                </>
              )}
            </Pressable>
          </View>

          {(activeJob || currentResult) ? (
            <View style={styles.resultStack}>
              <Text style={styles.stackTitle}>本次检测结果</Text>
              <DetectionResultCard result={currentResult} job={activeJob} onOpenDetail={activeSubmissionId ? openDetail : undefined} onRerun={activeSubmissionId ? handleRerun : undefined} />
              {currentResult?.retrieved_evidence?.length ? (
                <EvidenceListCard title="支撑判断的黑样本" subtitle="这些内容与当前文本在语义或关键词上更相近。" items={currentResult.retrieved_evidence} tone="black" />
              ) : null}
              {currentResult?.counter_evidence?.length ? (
                <EvidenceListCard title="用于校正的白样本" subtitle="这些证据更接近正常沟通，用来帮助系统降低误报。" items={currentResult.counter_evidence} tone="white" />
              ) : null}
              {currentResult?.advice?.length ? (
                <View style={styles.sectionCard}>
                  <Text style={styles.sectionTitle}>立即建议</Text>
                  <View style={styles.adviceList}>
                    {currentResult.advice.map((item) => (
                      <View key={item} style={styles.adviceRow}>
                        <View style={styles.adviceDot} />
                        <Text style={styles.adviceText}>{item}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}
            </View>
          ) : null}
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
    paddingTop: 10,
    paddingBottom: 28,
    gap: 16,
  },
  heroCard: {
    borderRadius: radius.xl,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 18,
    paddingVertical: 18,
    gap: 14,
    ...panelShadow,
  },
  heroRow: {
    flexDirection: "row",
    gap: 14,
    alignItems: "flex-start",
  },
  heroIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 18,
    backgroundColor: palette.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  heroCopy: {
    flex: 1,
    gap: 4,
  },
  eyebrow: {
    color: palette.accentStrong,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  heroTitle: {
    color: palette.ink,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  heroSubtitle: {
    color: palette.inkSoft,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: fontFamily.body,
  },
  heroMetaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  metaPill: {
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: palette.surfaceSoft,
  },
  metaPillText: {
    color: palette.accentStrong,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  sectionCard: {
    borderRadius: radius.lg,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 12,
    ...panelShadow,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  sectionHeaderCopy: {
    flex: 1,
    gap: 4,
  },
  sectionTitle: {
    color: palette.ink,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  sectionHint: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  helperText: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  textArea: {
    minHeight: 180,
    borderRadius: radius.md,
    backgroundColor: palette.surfaceSoft,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 14,
    paddingVertical: 14,
    color: palette.ink,
    fontSize: 14,
    lineHeight: 21,
    fontFamily: fontFamily.body,
  },
  inlineButtonRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  addButton: {
    minHeight: 38,
    borderRadius: radius.pill,
    backgroundColor: palette.accentSoft,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  addButtonText: {
    color: palette.accentStrong,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  previewGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  previewSection: {
    gap: 10,
  },
  previewTile: {
    width: "48.5%",
    borderRadius: radius.md,
    backgroundColor: palette.surfaceSoft,
    borderWidth: 1,
    borderColor: palette.line,
    padding: 10,
    gap: 8,
  },
  previewImage: {
    width: "100%",
    aspectRatio: 1.15,
    borderRadius: radius.md,
    backgroundColor: palette.backgroundDeep,
  },
  previewFile: {
    width: "100%",
    aspectRatio: 1.15,
    borderRadius: radius.md,
    backgroundColor: palette.backgroundDeep,
    alignItems: "center",
    justifyContent: "center",
  },
  previewName: {
    color: palette.ink,
    fontSize: 12,
    lineHeight: 17,
    fontFamily: fontFamily.body,
    paddingRight: 24,
  },
  removeChip: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 24,
    height: 24,
    borderRadius: radius.pill,
    backgroundColor: palette.surface,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: palette.line,
  },
  commandCard: {
    borderRadius: radius.xl,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.lineStrong,
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 14,
    ...panelShadow,
  },
  commandCopy: {
    gap: 6,
  },
  commandTitle: {
    color: palette.ink,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  commandText: {
    color: palette.inkSoft,
    fontSize: 13,
    lineHeight: 19,
    fontFamily: fontFamily.body,
  },
  submitButton: {
    alignSelf: "flex-start",
    minHeight: 46,
    borderRadius: radius.pill,
    backgroundColor: palette.accentStrong,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  submitButtonText: {
    color: palette.inkInverse,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  submitDisabled: {
    opacity: 0.6,
  },
  resultStack: {
    gap: 16,
  },
  stackTitle: {
    color: palette.ink,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  adviceList: {
    gap: 10,
  },
  adviceRow: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
  },
  adviceDot: {
    width: 8,
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: palette.accentStrong,
    marginTop: 6,
  },
  adviceText: {
    flex: 1,
    color: palette.ink,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: fontFamily.body,
  },
  buttonPressed: {
    transform: [{ scale: 0.98 }],
  },
});
