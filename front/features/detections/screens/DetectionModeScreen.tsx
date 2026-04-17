import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { ActivityIndicator, Alert, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "@/features/auth";
import { consumeStagedFloatingCapture, floatingCaptureService } from "@/features/floating-capture";
import { relationsApi } from "@/features/relations/api";
import { relationTypeMeta, type RelationProfileSummary } from "@/features/relations/types";
import { ApiError } from "@/shared/api";
import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";

import { buildDetectionSubmitFormData, detectionsApi } from "../api";
import type {
  AudioVerifyBatchJobResponse,
  DetectionMode,
  PickedFile,
} from "../types";

type AppendixSlot = "text" | "audio" | "image" | "video";
type AppendixItem = PickedFile & { key: string };

const modeConfig: Record<
  DetectionMode,
  {
    title: string;
    icon: keyof typeof MaterialCommunityIcons.glyphMap;
    tags: string[];
    allow: { text: boolean; textFiles: boolean; image: boolean; video: boolean; audio: boolean };
  }
> = {
  text: {
    title: "文本检测",
    icon: "message-text-outline",
    tags: ["文本", "RAG", "推理"],
    allow: { text: true, textFiles: true, image: false, video: false, audio: false },
  },
  visual: {
    title: "图片 / 视频检测",
    icon: "image-search-outline",
    tags: ["截图", "图片库", "视频"],
    allow: { text: true, textFiles: false, image: true, video: true, audio: false },
  },
  audio: {
    title: "AI语音合成识别",
    icon: "microphone-outline",
    tags: ["音频", "AI语音", "鉴伪"],
    allow: { text: false, textFiles: false, image: false, video: false, audio: true },
  },
  mixed: {
    title: "混合检测",
    icon: "layers-triple-outline",
    tags: ["混合", "文本", "附件"],
    allow: { text: true, textFiles: true, image: true, video: true, audio: true },
  },
};

const nextKey = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const TEXT_EXT = new Set([".txt", ".md", ".json", ".csv", ".log", ".html", ".htm", ".pdf", ".doc", ".docx"]);
const AUDIO_EXT = new Set([".mp3", ".m4a", ".aac", ".wav", ".ogg", ".flac", ".opus", ".amr"]);
const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".bmp"]);
const VIDEO_EXT = new Set([".mp4", ".mov", ".webm", ".mkv", ".avi", ".m4v", ".3gp"]);

function extOf(name: string) {
  const index = name.lastIndexOf(".");
  return index < 0 ? "" : name.slice(index).toLowerCase();
}

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

function formatPercent(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "--";
  }
  return `${(value * 100).toFixed(2)}%`;
}

function formatSeconds(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "--";
  }
  return value >= 10 ? `${value.toFixed(1)}s` : `${value.toFixed(2)}s`;
}

function formatAudioJobStatus(status: string) {
  switch (status) {
    case "pending":
      return "排队中";
    case "running":
      return "识别中";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    default:
      return status;
  }
}

function decodeDisplayFilename(name: string | null | undefined) {
  if (!name) {
    return "未命名音频";
  }

  let decoded = name;
  for (let i = 0; i < 3; i += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) {
        break;
      }
      decoded = next;
    } catch {
      break;
    }
  }
  return decoded;
}

function CountPill({ label, value }: { label: string; value: number | string }) {
  return (
    <View style={styles.countPill}>
      <Text style={styles.countPillLabel}>{label}</Text>
      <Text style={styles.countPillValue}>{value}</Text>
    </View>
  );
}

function PreviewGrid({
  items,
  onRemove,
}: {
  items: AppendixItem[];
  onRemove: (key: string) => void;
}) {
  if (!items.length) {
    return (
      <View style={styles.emptyTile}>
        <Text style={styles.emptyTileText}>空</Text>
      </View>
    );
  }

  return (
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
  );
}

function SectionHeader({
  title,
  count,
  actions,
}: {
  title: string;
  count?: number;
  actions?: ReactNode;
}) {
  return (
    <View style={styles.sectionHeaderRow}>
      <View style={styles.sectionHeaderCopy}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {typeof count === "number" ? (
          <View style={styles.sectionCount}>
            <Text style={styles.sectionCountText}>{count}</Text>
          </View>
        ) : null}
      </View>
      {actions}
    </View>
  );
}

function CompactActionButton({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={({ pressed }) => [styles.compactActionButton, pressed && styles.buttonPressed]} onPress={onPress}>
      <View style={styles.compactActionIconWrap}>
        <MaterialCommunityIcons name={icon} size={16} color={palette.accentStrong} />
      </View>
      <Text style={styles.compactActionLabel}>{label}</Text>
    </Pressable>
  );
}

function AudioBatchPanel({ batchJob }: { batchJob: AudioVerifyBatchJobResponse }) {
  return (
    <View style={styles.sectionCard}>
      <SectionHeader title="识别结果" count={batchJob.total_count} />
      <View style={styles.audioSummaryRow}>
        <CountPill label="总数" value={batchJob.total_count} />
        <CountPill label="完成" value={batchJob.completed_count} />
        <CountPill label="失败" value={batchJob.failed_count} />
      </View>
      {batchJob.items.map((item) => {
        const result = item.result;
        const isGenuine = result?.label === "genuine";
        return (
          <View key={item.item_id} style={styles.audioTaskCard}>
            <View style={styles.audioTaskHeader}>
              <View style={styles.audioTaskHeaderCopy}>
                <Text style={styles.audioTaskTitle} numberOfLines={2}>
                  {decodeDisplayFilename(item.filename)}
                </Text>
                <Text style={styles.audioTaskStatus}>{formatAudioJobStatus(item.status)}</Text>
              </View>
              {item.status === "pending" || item.status === "running" ? (
                <ActivityIndicator size="small" color={palette.accentStrong} />
              ) : null}
            </View>

            {item.status === "failed" ? (
              <Text style={styles.audioErrorText}>{item.error_message ?? "识别失败"}</Text>
            ) : null}

            {result ? (
              <>
                <View style={[styles.audioVerdictBadge, isGenuine ? styles.audioVerdictSafe : styles.audioVerdictRisk]}>
                  <Text style={styles.audioVerdictText}>{isGenuine ? "真人语音" : "AI合成"}</Text>
                </View>
                <View style={styles.audioMetricGrid}>
                  <View style={styles.audioMetricCard}>
                    <Text style={styles.audioMetricLabel}>真人概率</Text>
                    <Text style={styles.audioMetricValue}>{formatPercent(result.genuine_prob)}</Text>
                  </View>
                  <View style={styles.audioMetricCard}>
                    <Text style={styles.audioMetricLabel}>合成概率</Text>
                    <Text style={styles.audioMetricValue}>{formatPercent(result.fake_prob)}</Text>
                  </View>
                </View>
                <View style={styles.audioMetricGrid}>
                  <View style={styles.audioMetricCard}>
                    <Text style={styles.audioMetricLabel}>时长</Text>
                    <Text style={styles.audioMetricValue}>{formatSeconds(result.duration_sec)}</Text>
                  </View>
                  <View style={styles.audioMetricCard}>
                    <Text style={styles.audioMetricLabel}>Score</Text>
                    <Text style={styles.audioMetricValue}>{result.score.toFixed(4)}</Text>
                  </View>
                </View>
              </>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

export function DetectionModeScreen({ mode }: { mode: DetectionMode }) {
  const router = useRouter();
  const { token } = useAuth();
  const config = modeConfig[mode];
  const isTextMode = mode === "text";
  const isAudioMode = mode === "audio";
  const isVisualMode = mode === "visual";

  const [textContent, setTextContent] = useState("");
  const [textFiles, setTextFiles] = useState<AppendixItem[]>([]);
  const [audioFiles, setAudioFiles] = useState<AppendixItem[]>([]);
  const [imageFiles, setImageFiles] = useState<AppendixItem[]>([]);
  const [videoFiles, setVideoFiles] = useState<AppendixItem[]>([]);
  const [relations, setRelations] = useState<RelationProfileSummary[]>([]);
  const [relationsLoading, setRelationsLoading] = useState(false);
  const [selectedRelationId, setSelectedRelationId] = useState<string | null>(null);
  const [relationPickerVisible, setRelationPickerVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [matchingImageBank, setMatchingImageBank] = useState(false);
  const [audioVerifyBatchJob, setAudioVerifyBatchJob] = useState<AudioVerifyBatchJobResponse | null>(null);

  const ingestAssets = useCallback(
    (
      assets: { uri: string; name?: string | null; mimeType?: string | null }[],
      slot: AppendixSlot,
      setter: Dispatch<SetStateAction<AppendixItem[]>>,
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
        Alert.alert("文件类型不匹配", invalid.join("\n"));
      }
      if (valid.length) {
        if (slot === "audio") {
          setAudioVerifyBatchJob(null);
        }
        setter((prev) => [...prev, ...valid]);
      }
    },
    [],
  );

  const pickDocumentsForSlot = useCallback(
    async (slot: Extract<AppendixSlot, "text" | "audio" | "video">, setter: Dispatch<SetStateAction<AppendixItem[]>>) => {
      if (Platform.OS === "web") {
        Alert.alert("当前平台受限", "请在移动端选择文件");
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
    [ingestAssets],
  );

  const pickImages = useCallback(async () => {
    if (Platform.OS === "web") {
      Alert.alert("当前平台受限", "请在移动端选择图片");
      return;
    }
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("需要相册权限", "请先开启相册权限");
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
        setImageFiles,
      );
    }
  }, [ingestAssets]);

  const takePhoto = useCallback(async () => {
    if (Platform.OS === "web") {
      Alert.alert("当前平台受限", "请在移动端拍照上传");
      return;
    }
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("需要相机权限", "请先开启相机权限");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: false,
      quality: 0.9,
    });
    if (!result.canceled && result.assets.length) {
      ingestAssets(
        result.assets.map((asset) => ({
          uri: asset.uri,
          name: asset.fileName ?? "camera-image.jpg",
          mimeType: asset.mimeType ?? "image/jpeg",
        })),
        "image",
        setImageFiles,
      );
    }
  }, [ingestAssets]);

  const pickVideos = useCallback(async () => {
    if (Platform.OS === "web") {
      Alert.alert("当前平台受限", "请在移动端选择视频");
      return;
    }
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("需要相册权限", "请先开启相册权限");
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
        setVideoFiles,
      );
    }
  }, [ingestAssets]);

  const hasPayload = useMemo(() => {
    if (isVisualMode) {
      return imageFiles.length > 0 || videoFiles.length > 0;
    }
    return Boolean(textContent.trim()) || textFiles.length > 0 || audioFiles.length > 0 || imageFiles.length > 0 || videoFiles.length > 0;
  }, [audioFiles.length, imageFiles.length, isVisualMode, textContent, textFiles.length, videoFiles.length]);

  const selectedRelation = useMemo(
    () => relations.find((item) => item.id === selectedRelationId) ?? null,
    [relations, selectedRelationId],
  );

  const audioVerifyBusy = audioVerifyBatchJob?.status === "pending" || audioVerifyBatchJob?.status === "running";
  const materialCount = isVisualMode
    ? imageFiles.length + videoFiles.length
    : textFiles.length + audioFiles.length + imageFiles.length + videoFiles.length + (textContent.trim() ? 1 : 0);
  const canImageLibraryMatch = !isAudioMode && config.allow.image && imageFiles.length > 0;
  const isBusy = submitting || matchingImageBank || audioVerifyBusy;
  const canSubmit = isAudioMode ? audioFiles.length > 0 && !isBusy : hasPayload && !isBusy;
  const visualSelectionCount = imageFiles.length + videoFiles.length;
  const submitButtonLabel = isAudioMode ? "开始识别" : isVisualMode ? "开始综合识别" : "开始检测";

  const resetForm = useCallback(() => {
    setTextContent("");
    setTextFiles([]);
    setAudioFiles([]);
    setImageFiles([]);
    setVideoFiles([]);
  }, []);

  const consumeFloatingCapture = useCallback(async (options?: { showImportedAlert?: boolean; showEmptyAlert?: boolean }) => {
    if (!config.allow.image) {
      return;
    }

    const stagedCapture = consumeStagedFloatingCapture("visual");
    if (stagedCapture) {
      setImageFiles((prev) => {
        if (prev.some((item) => item.uri === stagedCapture.file.uri)) {
          return prev;
        }
        return [...prev, { ...stagedCapture.file, key: nextKey() }];
      });
      return;
    }

    const captured = await floatingCaptureService.consumePendingCapture();
    if (!captured) {
      if (options?.showEmptyAlert) {
        Alert.alert("暂无悬浮截图", "请先通过悬浮截图助手获取图片");
      }
      return;
    }

    setImageFiles((prev) => {
      if (prev.some((item) => item.uri === captured.uri)) {
        return prev;
      }
      return [...prev, { ...captured, key: nextKey() }];
    });

    if (options?.showImportedAlert ?? true) {
      Alert.alert("截图已加入", "可直接开始检测");
    }
  }, [config.allow.image]);

  const handleFloatingAssistantPress = useCallback(async () => {
    if (!floatingCaptureService.isSupported()) {
      Alert.alert("当前设备不支持", "仅安卓设备支持悬浮截图助手");
      return;
    }

    try {
      const status = await floatingCaptureService.getStatus();
      if (status.hasPendingCapture) {
        router.push("/floating-capture/action");
        return;
      }
      if (!status.overlayPermission) {
        floatingCaptureService.openOverlaySettings();
        Alert.alert("需要悬浮权限", "请开启悬浮窗权限后重新点击");
        return;
      }

      const nextStatus = await floatingCaptureService.startAssistant();
      if (nextStatus.hasPendingCapture) {
        router.push("/floating-capture/action");
        return;
      }
      if (!nextStatus.overlayPermission) {
        floatingCaptureService.openOverlaySettings();
        Alert.alert("权限未开启", "请允许悬浮助手显示在其他应用上层");
        return;
      }
      Alert.alert("悬浮助手已启动", "切到目标页面后即可截图");
    } catch (error) {
      const message = error instanceof Error ? error.message : "请检查悬浮权限后重试";
      Alert.alert("启动失败", message);
    }
  }, [router]);

  const loadRelations = useCallback(async () => {
    if (!token) {
      setRelations([]);
      setSelectedRelationId(null);
      return;
    }

    setRelationsLoading(true);
    try {
      const items = await relationsApi.list(token);
      setRelations(items);
      setSelectedRelationId((prev) => (prev && items.some((item) => item.id === prev) ? prev : null));
    } catch {
      // ignore
    } finally {
      setRelationsLoading(false);
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      void consumeFloatingCapture({ showImportedAlert: false });
      if (!isAudioMode) {
        void loadRelations();
      }
    }, [consumeFloatingCapture, isAudioMode, loadRelations]),
  );

  const handleImageLibraryMatch = useCallback(async () => {
    if (!token) {
      Alert.alert("未登录", "请先登录");
      return;
    }
    if (!imageFiles.length) {
      Alert.alert("缺少图片", "请先添加图片");
      return;
    }

    const formData = buildDetectionSubmitFormData({
      relation_profile_id: selectedRelationId,
      image_files: imageFiles,
    });

    setMatchingImageBank(true);
    try {
      const response = await detectionsApi.submit(token, formData);
      resetForm();
      setRelationPickerVisible(false);
      router.replace({
        pathname: "/records/[id]",
        params: { id: response.submission.id },
      });
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "图片库比对失败";
      Alert.alert("图片库比对失败", message);
    } finally {
      setMatchingImageBank(false);
    }
  }, [imageFiles, resetForm, router, selectedRelationId, token]);

  const handleSubmit = useCallback(async () => {
    if (!token) {
      Alert.alert("未登录", "请先登录");
      return;
    }

    if (isAudioMode) {
      if (!audioFiles.length) {
        Alert.alert("缺少音频", "请先添加音频");
        return;
      }

      setSubmitting(true);
      setAudioVerifyBatchJob(null);

      try {
        const submitResponse = await detectionsApi.submitAudioVerifyBatch(token, audioFiles);
        setAudioVerifyBatchJob({
          batch_id: submitResponse.batch_id,
          status: submitResponse.status,
          created_at: submitResponse.created_at,
          updated_at: submitResponse.created_at,
          total_count: submitResponse.total_count,
          completed_count: 0,
          failed_count: 0,
          items: submitResponse.items,
        });
      } catch (error) {
        const message = error instanceof ApiError ? error.message : "AI语音识别失败";
        Alert.alert("识别失败", message);
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (!hasPayload) {
      Alert.alert("缺少内容", "请先添加检测材料");
      return;
    }

    const formData = buildDetectionSubmitFormData({
      text_content: textContent,
      relation_profile_id: selectedRelationId,
      text_files: textFiles,
      audio_files: audioFiles,
      image_files: imageFiles,
      video_files: videoFiles,
    });

    setSubmitting(true);
    try {
      const response = await detectionsApi.submit(token, formData);
      resetForm();
      setRelationPickerVisible(false);
      router.replace({
        pathname: "/records/[id]",
        params: { id: response.submission.id },
      });
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "提交失败";
      Alert.alert("提交失败", message);
    } finally {
      setSubmitting(false);
    }
  }, [audioFiles, hasPayload, imageFiles, isAudioMode, resetForm, router, selectedRelationId, textContent, textFiles, token, videoFiles]);

  useEffect(() => {
    if (!token || !audioVerifyBatchJob) {
      return;
    }
    if (audioVerifyBatchJob.status !== "pending" && audioVerifyBatchJob.status !== "running") {
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const nextBatchJob = await detectionsApi.getAudioVerifyBatchJob(token, audioVerifyBatchJob.batch_id);
        setAudioVerifyBatchJob(nextBatchJob);
      } catch {
        // ignore
      }
    }, 2200);

    return () => clearTimeout(timer);
  }, [audioVerifyBatchJob, token]);

  if (isTextMode) {
    return (
      <View style={styles.root}>
        <View style={styles.backgroundOrbTop} />
        <View style={styles.backgroundOrbBottom} />
        <SafeAreaView style={styles.safeArea} edges={["top"]}>
          <View style={styles.textModeShell}>
            <View style={styles.textModeHeader}>
              <Pressable
                style={({ pressed }) => [styles.textModeBackButton, pressed && styles.buttonPressed]}
                onPress={() => router.back()}
              >
                <MaterialCommunityIcons name="chevron-left" size={20} color={palette.accentStrong} />
              </Pressable>

              <View style={styles.textModeTitleWrap}>
                <View style={styles.textModeTitleIcon}>
                  <MaterialCommunityIcons name={config.icon} size={18} color={palette.accentStrong} />
                </View>
                <Text style={styles.textModeTitle}>{config.title}</Text>
              </View>

              <View style={styles.textModeHeaderSpacer} />
            </View>

            <View style={styles.textModeCanvas}>
              <View style={styles.textModeEditorCard}>
                <View style={styles.textModeEditorHeader}>
                  <Text style={styles.textModeEditorTitle}>文本填写</Text>
                  <View style={styles.textModeQuickActions}>
                    <CompactActionButton
                      icon="account-outline"
                      label="关联对象"
                      onPress={() => setRelationPickerVisible(true)}
                    />
                    <CompactActionButton
                      icon="paperclip"
                      label="上传附件"
                      onPress={() => void pickDocumentsForSlot("text", setTextFiles)}
                    />
                  </View>
                </View>

                {(selectedRelation || textFiles.length > 0) ? (
                  <View style={styles.textModeMetaRow}>
                    {selectedRelation ? (
                      <View style={styles.textModeMetaChip}>
                        <MaterialCommunityIcons name="account-check-outline" size={14} color={palette.accentStrong} />
                        <Text style={styles.textModeMetaText} numberOfLines={1}>
                          {selectedRelation.name}
                        </Text>
                      </View>
                    ) : null}
                    {textFiles.length > 0 ? (
                      <View style={styles.textModeMetaChip}>
                        <MaterialCommunityIcons name="file-document-outline" size={14} color={palette.accentStrong} />
                        <Text style={styles.textModeMetaText} numberOfLines={1}>
                          {`已附 ${textFiles.length} 个附件`}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                ) : null}

                <TextInput
                  style={styles.textModeTextArea}
                  placeholder="粘贴聊天、转账话术、验证码内容"
                  placeholderTextColor={palette.inkSoft}
                  value={textContent}
                  onChangeText={setTextContent}
                  multiline
                  textAlignVertical="top"
                />
              </View>

              <Pressable
                style={({ pressed }) => [
                  styles.textModeSubmitButton,
                  pressed && canSubmit && styles.buttonPressed,
                  !canSubmit && styles.submitDisabled,
                ]}
                onPress={() => void handleSubmit()}
                disabled={!canSubmit}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color={palette.inkInverse} />
                ) : (
                  <Text style={styles.textModeSubmitText}>开始检测</Text>
                )}
              </Pressable>
            </View>
          </View>
        </SafeAreaView>

        <Modal
          transparent
          visible={relationPickerVisible}
          animationType="fade"
          onRequestClose={() => setRelationPickerVisible(false)}
        >
          <View style={styles.relationModalRoot}>
            <Pressable style={styles.relationModalBackdrop} onPress={() => setRelationPickerVisible(false)} />
            <View style={styles.relationModalCard}>
              <View style={styles.relationModalHeader}>
                <Text style={styles.relationModalTitle}>选择关联对象</Text>
                <Pressable
                  style={({ pressed }) => [styles.relationModalCloseButton, pressed && styles.buttonPressed]}
                  onPress={() => setRelationPickerVisible(false)}
                >
                  <MaterialCommunityIcons name="close" size={18} color={palette.inkSoft} />
                </Pressable>
              </View>

              <ScrollView
                style={styles.relationModalList}
                contentContainerStyle={styles.relationModalListContent}
                showsVerticalScrollIndicator={false}
              >
                <Pressable
                  onPress={() => {
                    setSelectedRelationId(null);
                    setRelationPickerVisible(false);
                  }}
                  style={({ pressed }) => [
                    styles.relationModalItem,
                    !selectedRelationId && styles.relationModalItemActive,
                    pressed && styles.buttonPressed,
                  ]}
                >
                  <Text style={[styles.relationModalItemTitle, !selectedRelationId && styles.relationModalItemTitleActive]}>
                    不关联
                  </Text>
                  <Text style={[styles.relationModalItemMeta, !selectedRelationId && styles.relationModalItemMetaActive]}>
                    仅按文本内容检测
                  </Text>
                </Pressable>

                {relations.length ? (
                  relations.map((relation) => {
                    const active = selectedRelationId === relation.id;
                    const meta = relationTypeMeta[relation.relation_type];
                    return (
                      <Pressable
                        key={relation.id}
                        onPress={() => {
                          setSelectedRelationId(relation.id);
                          setRelationPickerVisible(false);
                        }}
                        style={({ pressed }) => [
                          styles.relationModalItem,
                          active && styles.relationModalItemActive,
                          pressed && styles.buttonPressed,
                        ]}
                      >
                        <Text style={[styles.relationModalItemTitle, active && styles.relationModalItemTitleActive]}>
                          {relation.name}
                        </Text>
                        <Text style={[styles.relationModalItemMeta, active && styles.relationModalItemMetaActive]}>
                          {meta?.label ?? "对象"}
                        </Text>
                      </Pressable>
                    );
                  })
                ) : (
                  <View style={styles.relationModalEmpty}>
                    {relationsLoading ? (
                      <ActivityIndicator size="small" color={palette.accentStrong} />
                    ) : (
                      <Text style={styles.relationModalEmptyText}>暂无关联对象</Text>
                    )}
                  </View>
                )}
              </ScrollView>

              <Pressable
                style={({ pressed }) => [styles.relationModalManageButton, pressed && styles.buttonPressed]}
                onPress={() => {
                  setRelationPickerVisible(false);
                  router.push("/relations");
                }}
              >
                <MaterialCommunityIcons name="account-cog-outline" size={16} color={palette.accentStrong} />
                <Text style={styles.relationModalManageText}>管理对象</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.backgroundOrbTop} />
      <View style={styles.backgroundOrbBottom} />
        <SafeAreaView style={styles.safeArea} edges={["top"]}>
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <View style={styles.modeHeader}>
              <Pressable style={({ pressed }) => [styles.modeBackButton, pressed && styles.buttonPressed]} onPress={() => router.back()}>
                <MaterialCommunityIcons name="chevron-left" size={20} color={palette.accentStrong} />
              </Pressable>
              <Text style={styles.modeHeaderTitle}>{config.title}</Text>
              <View style={styles.modeHeaderSpacer} />
            </View>

            <View style={styles.heroCard}>
              <View style={styles.heroRow}>
                <View style={styles.heroIconWrap}>
                <MaterialCommunityIcons name={config.icon} size={24} color={palette.accentStrong} />
              </View>
              <View style={styles.heroCopy}>
                <Text style={styles.heroTitle}>{config.title}</Text>
                <View style={styles.heroTagRow}>
                  {config.tags.map((tag) => (
                    <View key={tag} style={styles.heroTag}>
                      <Text style={styles.heroTagText}>{tag}</Text>
                    </View>
                  ))}
                  {!isAudioMode && selectedRelation ? (
                    <View style={[styles.heroTag, styles.heroRelationTag]}>
                      <Text style={styles.heroRelationTagText}>{selectedRelation.name}</Text>
                    </View>
                  ) : null}
                </View>
              </View>
            </View>
            <View style={styles.heroMetricRow}>
              <CountPill label="文本" value={textContent.trim() ? 1 : 0} />
              <CountPill label="附件" value={textFiles.length + audioFiles.length + imageFiles.length + videoFiles.length} />
              <CountPill label="总数" value={materialCount} />
            </View>
          </View>

          {!isAudioMode ? (
            <View style={styles.sectionCard}>
              <SectionHeader
                title="关联对象"
                count={relations.length}
                actions={
                  <Pressable
                    style={({ pressed }) => [styles.addButton, pressed && styles.buttonPressed]}
                    onPress={() => router.push({ pathname: "/relations" })}
                  >
                    <MaterialCommunityIcons name="account-plus-outline" size={16} color={palette.accentStrong} />
                    <Text style={styles.addButtonText}>管理</Text>
                  </Pressable>
                }
              />
              {relations.length ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.relationChipRow}>
                  <Pressable
                    onPress={() => setSelectedRelationId(null)}
                    style={({ pressed }) => [
                      styles.relationChip,
                      !selectedRelationId && styles.relationChipActive,
                      pressed && styles.buttonPressed,
                    ]}
                  >
                    <Text style={[styles.relationChipText, !selectedRelationId && styles.relationChipTextActive]}>
                      不关联
                    </Text>
                  </Pressable>
                  {relations.map((relation) => {
                    const active = selectedRelationId === relation.id;
                    const meta = relationTypeMeta[relation.relation_type];
                    return (
                      <Pressable
                        key={relation.id}
                        onPress={() => setSelectedRelationId(relation.id)}
                        style={({ pressed }) => [
                          styles.relationChip,
                          active && styles.relationChipActive,
                          pressed && styles.buttonPressed,
                        ]}
                      >
                        <Text style={[styles.relationChipText, active && styles.relationChipTextActive]}>
                          {relation.name}
                        </Text>
                        <Text style={[styles.relationChipMeta, active && styles.relationChipMetaActive]}>
                          {meta?.label ?? "对象"}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              ) : (
                <View style={styles.emptyTile}>
                  {relationsLoading ? (
                    <ActivityIndicator size="small" color={palette.accentStrong} />
                  ) : (
                    <Text style={styles.emptyTileText}>暂无关联对象</Text>
                  )}
                </View>
              )}
            </View>
          ) : null}

          {isVisualMode ? (
            <View style={styles.uploadSpotlightCard}>
              <View style={styles.uploadSpotlightCopy}>
                <Text style={styles.uploadSpotlightEyebrow}>图片识别</Text>
                <Text style={styles.uploadSpotlightTitle}>添加识别素材</Text>
              </View>

              <View style={styles.visualActionGrid}>
                <Pressable style={({ pressed }) => [styles.visualActionButton, pressed && styles.buttonPressed]} onPress={() => void pickImages()}>
                  <MaterialCommunityIcons name="image-multiple-outline" size={20} color={palette.accentStrong} />
                  <Text style={styles.visualActionTitle}>相册导入</Text>
                </Pressable>
                <Pressable style={({ pressed }) => [styles.visualActionButton, pressed && styles.buttonPressed]} onPress={() => void takePhoto()}>
                  <MaterialCommunityIcons name="camera-outline" size={20} color={palette.accentStrong} />
                  <Text style={styles.visualActionTitle}>拍照上传</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.visualActionButton, pressed && styles.buttonPressed]}
                  onPress={() => void handleFloatingAssistantPress()}
                >
                  <MaterialCommunityIcons name="cellphone-screenshot" size={20} color={palette.accentStrong} />
                  <Text style={styles.visualActionTitle}>悬浮截图</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.visualActionButton, pressed && styles.buttonPressed]}
                  onPress={() => router.push("/detect-ai-face")}
                >
                  <MaterialCommunityIcons name="face-recognition" size={20} color={palette.accentStrong} />
                  <Text style={styles.visualActionTitle}>AI换脸</Text>
                </Pressable>
              </View>

              <View style={styles.visualSelectionBanner}>
                <Text style={styles.visualSelectionLabel}>当前已选</Text>
                <Text style={styles.visualSelectionValue}>{visualSelectionCount}</Text>
              </View>
            </View>
          ) : null}

          {!isVisualMode && config.allow.text ? (
            <View style={styles.sectionCard}>
              <SectionHeader title="核心文本" count={textContent.trim() ? 1 : 0} />
              <TextInput
                style={styles.textArea}
                placeholder="粘贴文本"
                placeholderTextColor={palette.inkSoft}
                value={textContent}
                onChangeText={setTextContent}
                multiline
                textAlignVertical="top"
              />
            </View>
          ) : null}

          {!isVisualMode && config.allow.textFiles ? (
            <View style={styles.sectionCard}>
              <SectionHeader
                title="文本附件"
                count={textFiles.length}
                actions={
                  <Pressable style={({ pressed }) => [styles.addButton, pressed && styles.buttonPressed]} onPress={() => void pickDocumentsForSlot("text", setTextFiles)}>
                    <MaterialCommunityIcons name="plus" size={16} color={palette.accentStrong} />
                    <Text style={styles.addButtonText}>添加</Text>
                  </Pressable>
                }
              />
              <PreviewGrid items={textFiles} onRemove={(key) => setTextFiles((prev) => prev.filter((item) => item.key !== key))} />
            </View>
          ) : null}

          {config.allow.image ? (
            isVisualMode ? (
              <View style={styles.sectionCard}>
                <SectionHeader title="图片预览" count={imageFiles.length} />
                <Text style={styles.sectionCaption}>保留关键截图即可</Text>
                <PreviewGrid items={imageFiles} onRemove={(key) => setImageFiles((prev) => prev.filter((item) => item.key !== key))} />
              </View>
            ) : (
              <View style={styles.sectionCard}>
                <SectionHeader
                  title="图片"
                  count={imageFiles.length}
                  actions={
                    <View style={styles.inlineButtonRow}>
                      <Pressable style={({ pressed }) => [styles.addButton, pressed && styles.buttonPressed]} onPress={() => void pickImages()}>
                        <MaterialCommunityIcons name="image-plus-outline" size={16} color={palette.accentStrong} />
                        <Text style={styles.addButtonText}>相册</Text>
                      </Pressable>
                    </View>
                  }
                />
                <PreviewGrid items={imageFiles} onRemove={(key) => setImageFiles((prev) => prev.filter((item) => item.key !== key))} />
              </View>
            )
          ) : null}

          {config.allow.video ? (
            <View style={styles.sectionCard}>
              <SectionHeader
                title="视频"
                count={videoFiles.length}
                actions={
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
                }
              />
              <PreviewGrid items={videoFiles} onRemove={(key) => setVideoFiles((prev) => prev.filter((item) => item.key !== key))} />
            </View>
          ) : null}

          {config.allow.audio ? (
            <View style={styles.sectionCard}>
              <SectionHeader
                title={isAudioMode ? "待识别音频" : "音频"}
                count={audioFiles.length}
                actions={
                  <Pressable style={({ pressed }) => [styles.addButton, pressed && styles.buttonPressed]} onPress={() => void pickDocumentsForSlot("audio", setAudioFiles)}>
                    <MaterialCommunityIcons name="microphone-plus" size={16} color={palette.accentStrong} />
                    <Text style={styles.addButtonText}>添加</Text>
                  </Pressable>
                }
              />
              <PreviewGrid
                items={audioFiles}
                onRemove={(key) => {
                  setAudioFiles((prev) => prev.filter((item) => item.key !== key));
                  setAudioVerifyBatchJob(null);
                }}
              />
            </View>
          ) : null}

          <View style={[styles.commandCard, isVisualMode && styles.visualCommandCard]}>
            {isVisualMode ? (
              <View style={styles.visualCommandCopy}>
                <Text style={styles.visualCommandTitle}>
                  {visualSelectionCount > 0 ? `已准备 ${visualSelectionCount} 项素材` : "请先添加识别素材"}
                </Text>
              </View>
            ) : (
              <View style={styles.commandStatsRow}>
                <CountPill label="文本" value={textContent.trim() ? 1 : 0} />
                <CountPill label="附件" value={textFiles.length + audioFiles.length + imageFiles.length + videoFiles.length} />
                <CountPill label="状态" value={isAudioMode && audioVerifyBatchJob ? formatAudioJobStatus(audioVerifyBatchJob.status) : "待提交"} />
              </View>
            )}
            <View style={styles.commandActionColumn}>
              {config.allow.image ? (
                <Pressable
                  style={({ pressed }) => [
                    isVisualMode ? styles.secondaryButton : styles.submitButton,
                    pressed && !isBusy && canImageLibraryMatch && styles.buttonPressed,
                    (!canImageLibraryMatch || isBusy) && styles.submitDisabled,
                  ]}
                  onPress={() => void handleImageLibraryMatch()}
                  disabled={!canImageLibraryMatch || isBusy}
                >
                  <MaterialCommunityIcons
                    name="image-search-outline"
                    size={18}
                    color={isVisualMode ? palette.accentStrong : palette.inkInverse}
                  />
                  <Text style={[styles.submitButtonText, isVisualMode && styles.secondaryButtonText]}>
                    {matchingImageBank ? "比对中" : "图片库比对"}
                  </Text>
                </Pressable>
              ) : null}

              <Pressable
                style={({ pressed }) => [
                  isVisualMode ? styles.submitButton : config.allow.image ? styles.secondaryButton : styles.submitButton,
                  pressed && canSubmit && styles.buttonPressed,
                  !canSubmit && styles.submitDisabled,
                ]}
                onPress={() => void handleSubmit()}
                disabled={!canSubmit}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color={isVisualMode || !config.allow.image ? palette.inkInverse : palette.accentStrong} />
                ) : (
                  <>
                    <MaterialCommunityIcons
                      name={isVisualMode ? "arrow-right" : config.allow.image ? "layers-triple-outline" : isAudioMode ? "waveform" : "arrow-right"}
                      size={18}
                      color={isVisualMode || !config.allow.image ? palette.inkInverse : palette.accentStrong}
                    />
                    <Text style={[styles.submitButtonText, !isVisualMode && config.allow.image && styles.secondaryButtonText]}>
                      {submitButtonLabel}
                    </Text>
                  </>
                )}
              </Pressable>
            </View>
          </View>

          {isAudioMode && audioVerifyBatchJob ? <AudioBatchPanel batchJob={audioVerifyBatchJob} /> : null}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.background },
  safeArea: { flex: 1 },
  textModeShell: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 18,
    gap: 12,
  },
  textModeHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 52,
  },
  textModeBackButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    alignItems: "center",
    justifyContent: "center",
  },
  textModeTitleWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  textModeTitleIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: palette.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  textModeTitle: {
    color: palette.ink,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  textModeHeaderSpacer: {
    width: 38,
    height: 38,
  },
  textModeCanvas: {
    flex: 1,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: palette.lineStrong,
    backgroundColor: palette.surface,
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 14,
    ...panelShadow,
  },
  textModeEditorCard: {
    flex: 1,
    paddingHorizontal: 0,
    paddingVertical: 0,
    gap: 12,
  },
  textModeEditorHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  textModeEditorTitle: {
    color: palette.ink,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  textModeQuickActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  compactActionButton: {
    minHeight: 34,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.surfaceSoft,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  compactActionIconWrap: {
    width: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  compactActionLabel: {
    color: palette.ink,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  textModeMetaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  textModeMetaChip: {
    maxWidth: "100%",
    borderRadius: radius.pill,
    backgroundColor: palette.surfaceSoft,
    paddingHorizontal: 10,
    paddingVertical: 7,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  textModeMetaText: {
    color: palette.accentStrong,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
    fontFamily: fontFamily.body,
    maxWidth: 220,
  },
  textModeTextArea: {
    flex: 1,
    minHeight: 0,
    color: palette.ink,
    fontSize: 15,
    lineHeight: 22,
    fontFamily: fontFamily.body,
    paddingHorizontal: 0,
    paddingVertical: 0,
    textAlignVertical: "top",
  },
  textModeSubmitButton: {
    minHeight: 52,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.lineStrong,
    backgroundColor: palette.accentStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  textModeSubmitText: {
    color: palette.inkInverse,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  relationModalRoot: {
    flex: 1,
    justifyContent: "flex-end",
  },
  relationModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(21, 42, 72, 0.28)",
  },
  relationModalCard: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    backgroundColor: palette.surface,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 24,
    gap: 12,
  },
  relationModalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  relationModalTitle: {
    color: palette.ink,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  relationModalCloseButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: palette.surfaceSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  relationModalList: {
    maxHeight: 320,
  },
  relationModalListContent: {
    gap: 8,
    paddingBottom: 4,
  },
  relationModalItem: {
    borderRadius: radius.lg,
    backgroundColor: palette.surfaceSoft,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 4,
  },
  relationModalItemActive: {
    backgroundColor: palette.accentStrong,
    borderColor: palette.accentStrong,
  },
  relationModalItemTitle: {
    color: palette.ink,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  relationModalItemTitleActive: {
    color: palette.inkInverse,
  },
  relationModalItemMeta: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fontFamily.body,
  },
  relationModalItemMetaActive: {
    color: "rgba(255,255,255,0.8)",
  },
  relationModalEmpty: {
    minHeight: 96,
    borderRadius: radius.lg,
    backgroundColor: palette.surfaceSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  relationModalEmptyText: {
    color: palette.inkSoft,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  relationModalManageButton: {
    minHeight: 44,
    borderRadius: radius.pill,
    backgroundColor: palette.surfaceSoft,
    borderWidth: 1,
    borderColor: palette.line,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  relationModalManageText: {
    color: palette.accentStrong,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  backgroundOrbTop: {
    position: "absolute",
    top: -92,
    left: -34,
    width: 220,
    height: 220,
    borderRadius: 999,
    backgroundColor: "rgba(117, 167, 255, 0.14)",
  },
  backgroundOrbBottom: {
    position: "absolute",
    right: -74,
    bottom: 160,
    width: 230,
    height: 230,
    borderRadius: 999,
    backgroundColor: "rgba(196, 218, 255, 0.18)",
  },
  content: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 28, gap: 16 },
  modeHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 44,
  },
  modeBackButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    alignItems: "center",
    justifyContent: "center",
  },
  modeHeaderTitle: {
    color: palette.ink,
    fontSize: 20,
    lineHeight: 24,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  modeHeaderSpacer: {
    width: 38,
    height: 38,
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
  heroRow: { flexDirection: "row", gap: 14, alignItems: "center" },
  heroIconWrap: {
    width: 54,
    height: 54,
    borderRadius: 18,
    backgroundColor: palette.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  heroCopy: { flex: 1, gap: 8 },
  heroTitle: {
    color: palette.ink,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  heroTagRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  heroTag: {
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: palette.surfaceSoft,
  },
  heroTagText: {
    color: palette.accentStrong,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  heroRelationTag: {
    backgroundColor: palette.accent,
  },
  heroRelationTagText: {
    color: palette.inkInverse,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  heroMetricRow: { flexDirection: "row", gap: 10 },
  countPill: {
    flex: 1,
    borderRadius: radius.md,
    backgroundColor: palette.surfaceSoft,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 4,
  },
  countPillLabel: { color: palette.inkSoft, fontSize: 11, lineHeight: 14, fontFamily: fontFamily.body },
  countPillValue: {
    color: palette.ink,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  uploadSpotlightCard: {
    borderRadius: radius.xl,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.lineStrong,
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 16,
    ...panelShadow,
  },
  uploadSpotlightCopy: { gap: 8 },
  uploadSpotlightEyebrow: {
    color: palette.accentStrong,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    fontFamily: fontFamily.body,
    letterSpacing: 0.2,
  },
  uploadSpotlightTitle: {
    color: palette.ink,
    fontSize: 21,
    lineHeight: 27,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  visualActionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 10,
    columnGap: 10,
  },
  visualActionButton: {
    width: "48%",
    borderRadius: radius.lg,
    backgroundColor: palette.surfaceSoft,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 8,
  },
  visualActionTitle: {
    color: palette.ink,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  visualSelectionBanner: {
    borderRadius: radius.lg,
    backgroundColor: palette.accentSoft,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  visualSelectionLabel: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fontFamily.body,
  },
  visualSelectionValue: {
    color: palette.accentStrong,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: "900",
    fontFamily: fontFamily.display,
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
    alignItems: "center",
  },
  sectionHeaderCopy: { flexDirection: "row", alignItems: "center", gap: 8 },
  sectionTitle: {
    color: palette.ink,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  sectionCount: {
    minWidth: 26,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: palette.surfaceSoft,
    alignItems: "center",
  },
  sectionCountText: {
    color: palette.accentStrong,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  sectionCaption: {
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
  inlineButtonRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  relationChipRow: {
    gap: 10,
    paddingRight: 6,
  },
  relationChip: {
    minWidth: 92,
    borderRadius: radius.md,
    backgroundColor: palette.surfaceSoft,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4,
  },
  relationChipActive: {
    backgroundColor: palette.accentStrong,
    borderColor: palette.accentStrong,
  },
  relationChipText: {
    color: palette.ink,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  relationChipTextActive: {
    color: palette.inkInverse,
  },
  relationChipMeta: {
    color: palette.inkSoft,
    fontSize: 11,
    lineHeight: 14,
    fontFamily: fontFamily.body,
  },
  relationChipMetaActive: {
    color: "rgba(255,255,255,0.78)",
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
  previewGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
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
  emptyTile: {
    borderRadius: radius.md,
    backgroundColor: palette.surfaceSoft,
    borderWidth: 1,
    borderColor: palette.line,
    paddingVertical: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTileText: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    fontFamily: fontFamily.body,
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
  visualCommandCard: { gap: 12 },
  visualCommandCopy: { gap: 6 },
  visualCommandTitle: {
    color: palette.ink,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  commandStatsRow: { flexDirection: "row", gap: 10 },
  commandActionColumn: { gap: 10 },
  submitButton: {
    minHeight: 48,
    borderRadius: radius.pill,
    backgroundColor: palette.accentStrong,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  secondaryButton: {
    minHeight: 48,
    borderRadius: radius.pill,
    backgroundColor: palette.surfaceSoft,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  submitButtonText: {
    color: palette.inkInverse,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  secondaryButtonText: {
    color: palette.accentStrong,
  },
  submitDisabled: { opacity: 0.55 },
  audioSummaryRow: {
    flexDirection: "row",
    gap: 10,
  },
  audioTaskCard: {
    borderRadius: radius.md,
    backgroundColor: palette.surfaceSoft,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 10,
  },
  audioTaskHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  audioTaskHeaderCopy: {
    flex: 1,
    gap: 4,
  },
  audioTaskTitle: {
    color: palette.ink,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  audioTaskStatus: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fontFamily.body,
  },
  audioErrorText: {
    color: "#C34F4F",
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  audioVerdictBadge: {
    alignSelf: "flex-start",
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  audioVerdictSafe: {
    backgroundColor: "#DFF7E8",
  },
  audioVerdictRisk: {
    backgroundColor: "#FFE3E3",
  },
  audioVerdictText: {
    color: palette.ink,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  audioMetricGrid: {
    flexDirection: "row",
    gap: 10,
  },
  audioMetricCard: {
    flex: 1,
    borderRadius: radius.md,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 6,
  },
  audioMetricLabel: {
    color: palette.inkSoft,
    fontSize: 11,
    lineHeight: 14,
    fontFamily: fontFamily.body,
  },
  audioMetricValue: {
    color: palette.ink,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  adviceList: { gap: 10 },
  adviceRow: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
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
  buttonPressed: { transform: [{ scale: 0.98 }] },
});
