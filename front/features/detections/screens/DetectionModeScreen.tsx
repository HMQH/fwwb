import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { LinearGradient } from "expo-linear-gradient";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { VideoView, useVideoPlayer } from "expo-video";
import * as VideoThumbnails from "expo-video-thumbnails";
import { useFocusEffect } from "@react-navigation/native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useAuth } from "@/features/auth";
import {
  consumeStagedFloatingCapture,
  floatingCaptureService,
} from "@/features/floating-capture";
import { ApiError } from "@/shared/api";
import { fontFamily, palette, radius } from "@/shared/theme";
import { TaskPrimaryButton, TaskScreen } from "@/shared/ui/TaskScreen";

import {
  consumeSelectedUploadedAudioDraft,
  type SelectedUploadedAudio,
} from "../audio-selection-session";
import { clearAudioScamInsight, setAudioScamInsight } from "../audioScamInsightStore";
import { buildDetectionSubmitFormData, detectionsApi } from "../api";
import { resolveDetectionFeaturePreset } from "../config/presets";
import type { DetectionMode, PickedFile } from "../types";

type PreviewFile = PickedFile & {
  key: string;
  thumbnailUri?: string | null;
};

function nextKey() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function ActionChip({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.actionChip, pressed && styles.chipPressed]}
      onPress={onPress}
    >
      <MaterialCommunityIcons
        name={icon}
        size={15}
        color={palette.accentStrong}
      />
      <Text style={styles.actionChipText}>{label}</Text>
    </Pressable>
  );
}

function FileBadge({
  label,
  onRemove,
}: {
  label: string;
  onRemove?: () => void;
}) {
  return (
    <View style={styles.fileBadge}>
      <Text style={styles.fileBadgeText} numberOfLines={1}>
        {label}
      </Text>
      {onRemove ? (
        <Pressable
          style={({ pressed }) => [styles.fileBadgeRemove, pressed && styles.chipPressed]}
          onPress={onRemove}
        >
          <MaterialCommunityIcons
            name="close"
            size={14}
            color={palette.inkSoft}
          />
        </Pressable>
      ) : null}
    </View>
  );
}

function PreviewGrid({
  files,
  onRemove,
  emptyLabel,
  emptyIcon,
}: {
  files: PreviewFile[];
  onRemove: (key: string) => void;
  emptyLabel: string;
  emptyIcon: keyof typeof MaterialCommunityIcons.glyphMap;
}) {
  const visibleFiles = files.slice(0, 4);

  if (!visibleFiles.length) {
    return (
      <View style={styles.previewEmpty}>
        <MaterialCommunityIcons
          name={emptyIcon}
          size={28}
          color={palette.inkSoft}
        />
        <Text style={styles.previewEmptyText}>{emptyLabel}</Text>
      </View>
    );
  }

  return (
    <View style={styles.previewGrid}>
      {visibleFiles.map((file, index) => (
        <View key={file.key} style={styles.previewTile}>
          <Image source={{ uri: file.uri }} style={styles.previewImage} contentFit="cover" />
          {index === 3 && files.length > 4 ? (
            <View style={styles.previewMoreMask}>
              <Text style={styles.previewMoreText}>+{files.length - 4}</Text>
            </View>
          ) : null}
          <Pressable
            style={({ pressed }) => [
              styles.previewRemove,
              pressed && styles.chipPressed,
            ]}
            onPress={() => onRemove(file.key)}
          >
            <MaterialCommunityIcons name="close" size={13} color={palette.ink} />
          </Pressable>
        </View>
      ))}
    </View>
  );
}

function VideoPreviewGrid({
  files,
  onRemove,
  onOpen,
}: {
  files: PreviewFile[];
  onRemove: (key: string) => void;
  onOpen: (file: PreviewFile) => void;
}) {
  const visibleFiles = files.slice(0, 4);

  if (!visibleFiles.length) {
    return (
      <View style={styles.previewEmpty}>
        <MaterialCommunityIcons
          name="movie-open-play-outline"
          size={30}
          color={palette.inkSoft}
        />
        <Text style={styles.previewEmptyText}>视频预览</Text>
      </View>
    );
  }

  return (
    <View style={styles.previewGrid}>
      {visibleFiles.map((file, index) => (
        <Pressable
          key={file.key}
          style={({ pressed }) => [
            styles.previewTile,
            pressed && styles.chipPressed,
          ]}
          onPress={() => onOpen(file)}
        >
          {file.thumbnailUri ? (
            <Image
              source={{ uri: file.thumbnailUri }}
              style={styles.previewImage}
              contentFit="cover"
            />
          ) : (
            <View style={styles.videoTileFallback}>
              <MaterialCommunityIcons
                name="movie-open-play-outline"
                size={30}
                color="#FFFFFF"
              />
            </View>
          )}
          <View style={styles.videoTileOverlay}>
            <View style={styles.videoTilePlay}>
              <MaterialCommunityIcons
                name="play"
                size={16}
                color="#FFFFFF"
              />
            </View>
          </View>
          <View style={styles.videoNameBar}>
            <Text style={styles.videoNameText} numberOfLines={1}>
              {file.name}
            </Text>
          </View>
          {index === 3 && files.length > 4 ? (
            <View style={styles.previewMoreMask}>
              <Text style={styles.previewMoreText}>+{files.length - 4}</Text>
            </View>
          ) : null}
          <Pressable
            style={({ pressed }) => [
              styles.previewRemove,
              pressed && styles.chipPressed,
            ]}
            onPress={() => onRemove(file.key)}
          >
            <MaterialCommunityIcons name="close" size={13} color={palette.ink} />
          </Pressable>
        </Pressable>
      ))}
    </View>
  );
}

function VideoPreviewModal({
  visible,
  file,
  onClose,
}: {
  visible: boolean;
  file: PreviewFile | null;
  onClose: () => void;
}) {
  const player = useVideoPlayer(
    file ? { uri: file.uri } : null,
    (videoPlayer) => {
      videoPlayer.loop = true;
    },
  );

  useEffect(() => {
    if (visible && file) {
      player.currentTime = 0;
      player.play();
      return;
    }
    player.pause();
  }, [file, player, visible]);

  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.videoModalBackdrop}>
        <View style={styles.videoModalCard}>
          <View style={styles.videoModalHeader}>
            <Text style={styles.videoModalTitle} numberOfLines={1}>
              {file?.name ?? "视频预览"}
            </Text>
            <Pressable
              style={({ pressed }) => [
                styles.videoModalClose,
                pressed && styles.chipPressed,
              ]}
              onPress={onClose}
            >
              <MaterialCommunityIcons
                name="close"
                size={18}
                color={palette.ink}
              />
            </Pressable>
          </View>
          <View style={styles.videoModalPlayerWrap}>
            {file ? (
              <VideoView
                player={player}
                nativeControls
                contentFit="contain"
                style={styles.videoModalPlayer}
              />
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}

async function buildVideoPreviewFile(file: PickedFile): Promise<PreviewFile> {
  let thumbnailUri: string | null = null;
  try {
    const thumbnail = await VideoThumbnails.getThumbnailAsync(file.uri, {
      time: 1000,
      quality: 0.7,
    });
    thumbnailUri = thumbnail.uri;
  } catch {
    thumbnailUri = null;
  }

  return {
    ...file,
    key: nextKey(),
    thumbnailUri,
  };
}

function ReasoningModeSwitch({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  const options = [
    {
      key: "standard",
      label: "普通检测",
      icon: "radar" as const,
      active: !value,
      tint: "#2F70E6",
      soft: "#EAF2FF",
    },
    {
      key: "deep",
      label: "深度推理",
      icon: "graph-outline" as const,
      active: value,
      tint: "#E38A57",
      soft: "#FFF1E8",
    },
  ];

  return (
    <LinearGradient
      colors={["#F7FBFF", "#EEF5FF"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.modeSwitchShell}
    >
      {options.map((option) => (
        <Pressable
          key={option.key}
          style={({ pressed }) => [
            styles.modeOption,
            option.active && styles.modeOptionActive,
            pressed && styles.chipPressed,
          ]}
          onPress={() => onChange(option.key === "deep")}
        >
          {option.active ? (
            <LinearGradient
              colors={option.key === "deep" ? ["#FFF2EA", "#FFE2D0"] : ["#EEF5FF", "#DCEAFF"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.modeOptionGlow}
            />
          ) : null}
          <View style={[styles.modeIconWrap, { backgroundColor: option.soft }]}>
            <MaterialCommunityIcons name={option.icon} size={16} color={option.tint} />
          </View>
          <Text style={[styles.modeLabel, option.active && styles.modeLabelActive]}>{option.label}</Text>
        </Pressable>
      ))}
    </LinearGradient>
  );
}

function MetaChip({
  icon,
  label,
  tone = "blue",
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
  tone?: "blue" | "orange" | "slate";
}) {
  const toneMap = {
    blue: { soft: "#EEF5FF", ink: "#2F70E6" },
    orange: { soft: "#FFF1E8", ink: "#D96A4A" },
    slate: { soft: "#F3F6FB", ink: "#5B6880" },
  } as const;
  const current = toneMap[tone];

  return (
    <View style={[styles.metaChip, { backgroundColor: current.soft }]}>
      <MaterialCommunityIcons name={icon} size={13} color={current.ink} />
      <Text style={[styles.metaChipText, { color: current.ink }]}>{label}</Text>
    </View>
  );
}

function TextModeFlowStrip({ deepReasoning }: { deepReasoning: boolean }) {
  const flow = deepReasoning
    ? ["原文", "阶段", "反证", "判定"]
    : ["原文", "规则", "检索", "结果"];
  const tone = deepReasoning
    ? { soft: "#FFF7EF", edge: "#F2D9C2", ink: "#D47C3A" }
    : { soft: "#F7FBFF", edge: "#D7E6FC", ink: "#2F70E6" };

  return (
    <View style={[styles.modeFlowStrip, { backgroundColor: tone.soft, borderColor: tone.edge }]}>
      <View style={styles.modeFlowRail} />
      <View style={styles.modeFlowRow}>
        {flow.map((item, index) => {
          const active = index === flow.length - 1;
          return (
            <View key={item} style={styles.modeFlowSlot}>
              <View
                style={[
                  styles.modeFlowNode,
                  {
                    borderColor: tone.edge,
                    backgroundColor: active ? tone.ink : "#FFFFFF",
                  },
                ]}
              >
                {active ? (
                  <MaterialCommunityIcons name="check" size={13} color="#FFFFFF" />
                ) : (
                  <View style={[styles.modeFlowCore, { backgroundColor: tone.ink }]} />
                )}
              </View>
              <Text style={[styles.modeFlowLabel, active && { color: tone.ink }]}>{item}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

export function DetectionModeScreen({ mode }: { mode: DetectionMode }) {
  const router = useRouter();
  const { feature } = useLocalSearchParams<{ feature?: string }>();
  const { token } = useAuth();
  const preset = resolveDetectionFeaturePreset(mode, feature);
  const videoAnalysisTarget =
    preset.key === "video-ai"
      ? "ai"
      : preset.key === "video-physiology"
      ? "physiology"
      : undefined;
  const isImageFeature = preset.key === "image";
  const isVideoFeature = Boolean(videoAnalysisTarget);

  const [textContent, setTextContent] = useState("");
  const [textFiles, setTextFiles] = useState<PreviewFile[]>([]);
  const [imageFiles, setImageFiles] = useState<PreviewFile[]>([]);
  const [videoFiles, setVideoFiles] = useState<PreviewFile[]>([]);
  const [previewingVideo, setPreviewingVideo] = useState<PreviewFile | null>(null);
  const [audioFile, setAudioFile] = useState<PreviewFile | null>(null);
  const [uploadedAudio, setUploadedAudio] = useState<SelectedUploadedAudio | null>(null);
  const [deepReasoning, setDeepReasoning] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [analyzingInsight, setAnalyzingInsight] = useState(false);

  const isTextMode = mode === "text";
  const isVisualMode = mode === "visual";
  const isAudioMode = mode === "audio";

  const hasTextPayload = Boolean(textContent.trim()) || textFiles.length > 0;
  const hasVisualPayload = isVideoFeature ? videoFiles.length > 0 : imageFiles.length > 0;
  const hasAudioSource = Boolean(audioFile || uploadedAudio);
  const canSubmit =
    (isTextMode && hasTextPayload) ||
    (isVisualMode && hasVisualPayload) ||
    (isAudioMode && hasAudioSource);

  const mergeVisualFile = useCallback((file: PickedFile) => {
    setImageFiles((prev) => {
      if (prev.some((item) => item.uri === file.uri)) {
        return prev;
      }
      return [...prev, { ...file, key: nextKey() }];
    });
  }, []);

  const mergeVideoFile = useCallback((file: PreviewFile) => {
    setVideoFiles((prev) => {
      if (prev.some((item) => item.uri === file.uri)) {
        return prev;
      }
      return [...prev, file];
    });
  }, []);

  useEffect(() => {
    if (isImageFeature) {
      setVideoFiles([]);
      setPreviewingVideo(null);
      return;
    }
    if (isVideoFeature) {
      setImageFiles([]);
      return;
    }
    setPreviewingVideo(null);
  }, [isImageFeature, isVideoFeature]);

  useFocusEffect(
    useCallback(() => {
      if (!isVisualMode || !isImageFeature) {
        return;
      }

      const staged = consumeStagedFloatingCapture("visual");
      if (staged?.file) {
        mergeVisualFile(staged.file);
        return;
      }

      void floatingCaptureService.consumePendingCapture().then((captured) => {
        if (!captured) {
          return;
        }
        mergeVisualFile(captured);
      });
    }, [isImageFeature, isVisualMode, mergeVisualFile]),
  );

  useFocusEffect(
    useCallback(() => {
      if (!isAudioMode) {
        return;
      }

      const draft = consumeSelectedUploadedAudioDraft();
      if (!draft?.items.length) {
        return;
      }

      if (!token) {
        Alert.alert("未登录", "请先登录");
        return;
      }

      const target = draft.items[0];
      setUploadedAudio(target);
      setAudioFile(null);
      clearAudioScamInsight();

      setAnalyzingInsight(true);
      void detectionsApi
        .analyzeAudioScamInsightFromUploads(token, {
          audio_path: target.file_path,
          filename: target.file_name,
        })
        .then((insight) => {
          setAudioScamInsight(insight, {
            sourceFilename: target.file_name,
            sourceAudioUri: target.file_url,
            sourceAudioMimeType: "audio/mpeg",
            returnHref: "/detect-audio",
          });
          router.push("/audio-deep-analysis" as never);
        })
        .catch((error) => {
          const message =
            error instanceof ApiError ? error.message : "语音深度分析失败";
          Alert.alert("分析失败", message);
        })
        .finally(() => {
          setAnalyzingInsight(false);
        });
    }, [isAudioMode, router, token]),
  );

  const pickTextFiles = useCallback(async () => {
    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: true,
      type: ["text/plain", "application/json", "text/markdown", "*/*"],
    });
    if (result.canceled) {
      return;
    }
    setTextFiles((prev) => [
      ...prev,
      ...result.assets.map((asset) => ({
        uri: asset.uri,
        name: asset.name,
        type: asset.mimeType ?? "text/plain",
        key: nextKey(),
      })),
    ]);
  }, []);

  const pickVideos = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("需要相册权限", "请先允许访问相册");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["videos"],
      allowsMultipleSelection: true,
      selectionLimit: 9,
    });

    if (result.canceled) {
      return;
    }

    const previewFiles = await Promise.all(
      result.assets.map((asset) =>
        buildVideoPreviewFile({
          uri: asset.uri,
          name: asset.fileName ?? `video-${Date.now()}.mp4`,
          type: asset.mimeType ?? "video/mp4",
        }),
      ),
    );
    previewFiles.forEach((file) => {
      mergeVideoFile(file);
    });
  }, [mergeVideoFile]);

  const pickImages = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("需要相册权限", "请先允许访问相册");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      selectionLimit: 9,
      quality: 0.9,
    });

    if (result.canceled) {
      return;
    }

    result.assets.forEach((asset) => {
      mergeVisualFile({
        uri: asset.uri,
        name: asset.fileName ?? `image-${Date.now()}.jpg`,
        type: asset.mimeType ?? "image/jpeg",
      });
    });
  }, [mergeVisualFile]);

  const takePhoto = useCallback(async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("需要相机权限", "请先允许访问相机");
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      quality: 0.9,
    });

    if (result.canceled || !result.assets.length) {
      return;
    }

    const asset = result.assets[0];
    mergeVisualFile({
      uri: asset.uri,
      name: asset.fileName ?? `camera-${Date.now()}.jpg`,
      type: asset.mimeType ?? "image/jpeg",
    });
  }, [mergeVisualFile]);

  const openFloatingCapture = useCallback(() => {
    router.push("/floating-capture/action" as never);
  }, [router]);

  const pickAudio = useCallback(async () => {
    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: false,
      type: "audio/*",
    });
    if (result.canceled || !result.assets.length) {
      return;
    }

    const asset = result.assets[0];
    setUploadedAudio(null);
    clearAudioScamInsight();
    setAudioFile({
      uri: asset.uri,
      name: asset.name,
      type: asset.mimeType ?? "audio/mpeg",
      key: nextKey(),
    });
  }, []);

  const removeTextFile = useCallback((key: string) => {
    setTextFiles((prev) => prev.filter((item) => item.key !== key));
  }, []);

  const removeImageFile = useCallback((key: string) => {
    setImageFiles((prev) => prev.filter((item) => item.key !== key));
  }, []);

  const removeVideoFile = useCallback((key: string) => {
    setVideoFiles((prev) => prev.filter((item) => item.key !== key));
    setPreviewingVideo((prev) => (prev?.key === key ? null : prev));
  }, []);

  const handleOpenInsight = useCallback(async () => {
    if (!token) {
      Alert.alert("未登录", "请先登录");
      return;
    }
    if (!audioFile && !uploadedAudio) {
      void pickAudio();
      return;
    }

    setAnalyzingInsight(true);
    try {
      const insight = audioFile
        ? await detectionsApi.analyzeAudioScamInsight(token, audioFile)
        : await detectionsApi.analyzeAudioScamInsightFromUploads(token, {
          audio_path: uploadedAudio!.file_path,
          filename: uploadedAudio!.file_name,
        });
      setAudioScamInsight(insight, {
        sourceFilename: audioFile?.name ?? uploadedAudio?.file_name,
        sourceAudioUri: audioFile?.uri ?? uploadedAudio?.file_url,
        sourceAudioMimeType: audioFile?.type ?? "audio/mpeg",
        returnHref: "/detect-audio",
      });
      router.push("/audio-deep-analysis" as never);
    } catch (error) {
      const message =
        error instanceof ApiError ? error.message : "语音深度分析失败";
      Alert.alert("分析失败", message);
    } finally {
      setAnalyzingInsight(false);
    }
  }, [audioFile, pickAudio, router, token, uploadedAudio]);

  const handleSubmit = useCallback(async () => {
    if (!token) {
      Alert.alert("未登录", "请先登录");
      return;
    }

    if (isAudioMode) {
      await handleOpenInsight();
      return;
    }

    if (!canSubmit) {
      Alert.alert("缺少内容", "请先添加检测材料");
      return;
    }

    const formData = buildDetectionSubmitFormData({
      text_content: textContent,
      deep_reasoning: deepReasoning,
      video_analysis_target: videoAnalysisTarget,
      text_files: textFiles,
      image_files: imageFiles,
      video_files: videoFiles,
    });

    setSubmitting(true);
    try {
      const response = await detectionsApi.submit(token, formData);
      setTextContent("");
      setTextFiles([]);
      setImageFiles([]);
      setVideoFiles([]);
      setPreviewingVideo(null);
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
  }, [canSubmit, deepReasoning, handleOpenInsight, imageFiles, isAudioMode, router, textContent, textFiles, token, videoAnalysisTarget, videoFiles]);

  const primaryLabel = useMemo(() => {
    if (isAudioMode) {
      if (!hasAudioSource) {
        return "上传音频";
      }
      return preset.buttonLabel;
    }
    if (isTextMode && deepReasoning) {
      return "开始检测";
    }
    if (isTextMode) {
      return "开始检测";
    }
    return preset.buttonLabel;
  }, [deepReasoning, hasAudioSource, isAudioMode, isTextMode, preset.buttonLabel]);

  const handlePrimaryPress = useCallback(() => {
    if (isAudioMode && !hasAudioSource) {
      void pickAudio();
      return;
    }
    void handleSubmit();
  }, [handleSubmit, hasAudioSource, isAudioMode, pickAudio]);

  return (
    <TaskScreen
      title={preset.title}
      cardStyle={isTextMode && deepReasoning ? styles.taskCardDeep : undefined}
      footer={
        <TaskPrimaryButton
          label={primaryLabel}
          onPress={handlePrimaryPress}
          disabled={(!isAudioMode && !canSubmit) || analyzingInsight}
          loading={submitting || analyzingInsight}
        />
      }
    >
      <View style={styles.cardContent}>
        <View style={styles.headRow}>
          <View style={[styles.headIcon, { backgroundColor: preset.soft }]}>
            <MaterialCommunityIcons
              name={preset.icon}
              size={22}
              color={preset.tint}
            />
          </View>
          <View style={styles.headCopy}>
            <Text style={styles.headTitle}>{preset.title}</Text>
            <View style={styles.headMetaRow}>
              {isTextMode ? (
                <>
                  <MetaChip
                    icon={deepReasoning ? "graph-outline" : "radar"}
                    label={deepReasoning ? "深度" : "普通"}
                    tone={deepReasoning ? "orange" : "blue"}
                  />
                  <MetaChip icon="file-document-outline" label={`${textFiles.length} 附件`} tone="slate" />
                  <MetaChip
                    icon={textContent.trim() ? "text-box-check-outline" : "text-box-outline"}
                    label={textContent.trim() ? "已输入" : "未输入"}
                    tone="slate"
                  />
                </>
              ) : isVisualMode ? (
                <>
                  {isVideoFeature ? (
                    <>
                      <MetaChip icon="filmstrip-box-multiple" label={`${videoFiles.length} 视频`} tone="blue" />
                      <MetaChip
                        icon={videoAnalysisTarget === "ai" ? "movie-open-play-outline" : "account-heart-outline"}
                        label={videoAnalysisTarget === "ai" ? "AI视频" : "生理特征"}
                        tone="orange"
                      />
                    </>
                  ) : (
                    <MetaChip icon="image-multiple-outline" label={`${imageFiles.length} 图片`} tone="blue" />
                  )}
                  <MetaChip
                    icon={hasVisualPayload ? "check-circle-outline" : isVideoFeature ? "video-off-outline" : "image-off-outline"}
                    label={hasVisualPayload ? "已选择" : "未选择"}
                    tone="slate"
                  />
                </>
              ) : (
                <>
                  <MetaChip icon="waveform" label={audioFile ? "已上传" : "未上传"} tone="blue" />
                  <MetaChip icon="file-music-outline" label={audioFile ? "1 音频" : "0 音频"} tone="slate" />
                </>
              )}
            </View>
          </View>
        </View>

        {isTextMode ? (
          <>
            <ReasoningModeSwitch value={deepReasoning} onChange={setDeepReasoning} />

            <TextModeFlowStrip deepReasoning={deepReasoning} />

            <View style={[styles.inputWrap, deepReasoning && styles.inputWrapDeep]}>
              <TextInput
                style={styles.textInput}
                value={textContent}
                onChangeText={setTextContent}
                multiline
                placeholder="输入要检测的文字"
                placeholderTextColor={palette.inkSoft}
                textAlignVertical="top"
              />
            </View>

            <View style={styles.actionRow}>
              <ActionChip
                icon="paperclip"
                label="上传文本"
                onPress={() => void pickTextFiles()}
              />
            </View>

            <View style={styles.fileRow}>
              {textFiles.length ? (
                textFiles.map((file) => (
                  <FileBadge
                    key={file.key}
                    label={file.name}
                    onRemove={() => removeTextFile(file.key)}
                  />
                ))
              ) : (
                <Text style={styles.placeholderLine}>文本附件</Text>
              )}
            </View>
          </>
        ) : null}

        {isVisualMode ? (
          <>
            {isVideoFeature ? (
              <>
                <VideoPreviewGrid
                  files={videoFiles}
                  onRemove={removeVideoFile}
                  onOpen={setPreviewingVideo}
                />

                <View style={styles.actionRow}>
                  <ActionChip
                    icon="video-outline"
                    label="相册"
                    onPress={() => void pickVideos()}
                  />
                </View>
              </>
            ) : (
              <>
                <PreviewGrid
                  files={imageFiles}
                  onRemove={removeImageFile}
                  emptyLabel="图片预览"
                  emptyIcon="image-outline"
                />

                <View style={styles.actionRow}>
                  <ActionChip
                    icon="image-outline"
                    label="相册"
                    onPress={() => void pickImages()}
                  />
                  <ActionChip
                    icon="camera-outline"
                    label="拍照"
                    onPress={() => void takePhoto()}
                  />
                  <ActionChip
                    icon="gesture-tap-button"
                    label="悬浮截图"
                    onPress={openFloatingCapture}
                  />
                </View>
              </>
            )}
          </>
        ) : null}

        {isAudioMode ? (
          <>
            <View style={styles.audioPanel}>
              <MaterialCommunityIcons
                name="waveform"
                size={28}
                color={preset.tint}
              />
              <Text style={styles.audioFileName} numberOfLines={2}>
                {audioFile?.name ?? uploadedAudio?.file_name ?? "未上传音频"}
              </Text>
            </View>

            <View style={styles.actionRow}>
              <ActionChip
                icon="waveform"
                label="本地音频"
                onPress={() => void pickAudio()}
              />
              <ActionChip
                icon="folder-music-outline"
                label="上传管理"
                onPress={() => router.push("/detect-audio/select-uploaded" as never)}
              />
            </View>

            <Pressable
              style={({ pressed }) => [
                styles.audioInsightButton,
                pressed && styles.chipPressed,
                (!hasAudioSource || analyzingInsight) && styles.audioInsightButtonDisabled,
              ]}
              disabled={!hasAudioSource || analyzingInsight}
              onPress={() => void handleOpenInsight()}
            >
              <View style={styles.audioInsightCopy}>
                <Text style={styles.audioInsightTitle}>语音深度分析</Text>
                <Text style={styles.audioInsightMeta}>雷达画像 · 过程演化 · 证据分段</Text>
              </View>
              {analyzingInsight ? (
                <ActivityIndicator size="small" color={palette.accentStrong} />
              ) : (
                <MaterialCommunityIcons
                  name="chevron-right"
                  size={18}
                  color={palette.accentStrong}
                />
              )}
            </Pressable>

            <View style={styles.audioInsightPreview}>
              <View style={styles.audioInsightPreviewBadge}>
                <Text style={styles.audioInsightPreviewBadgeText}>分析输出</Text>
              </View>
              <View style={styles.audioInsightPreviewRow}>
                <Text style={styles.audioInsightPreviewItem}>行为画像</Text>
                <Text style={styles.audioInsightPreviewDivider}>·</Text>
                <Text style={styles.audioInsightPreviewItem}>阶段轨迹</Text>
                <Text style={styles.audioInsightPreviewDivider}>·</Text>
                <Text style={styles.audioInsightPreviewItem}>关键证据</Text>
              </View>
              <Text style={styles.placeholderLine}>
                上传后直接进入语音诈骗深度分析，不再展示 AI 合成音频鉴别页。
              </Text>
            </View>
          </>
        ) : null}

        <VideoPreviewModal
          visible={Boolean(previewingVideo)}
          file={previewingVideo}
          onClose={() => setPreviewingVideo(null)}
        />
      </View>
    </TaskScreen>
  );
}

const styles = StyleSheet.create({
  taskCardDeep: {
    borderColor: "#CCDCF9",
    backgroundColor: "#FBFDFF",
  },
  cardContent: {
    flex: 1,
    gap: 16,
  },
  headRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  headIcon: {
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
  headMetaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  metaChip: {
    minHeight: 28,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  metaChipText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  modeFlowStrip: {
    borderRadius: radius.xl,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 14,
    overflow: "hidden",
  },
  modeFlowRail: {
    position: "absolute",
    left: 34,
    right: 34,
    top: 30,
    height: 3,
    borderRadius: radius.pill,
    backgroundColor: "#DDE7F7",
  },
  modeFlowRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  modeFlowSlot: {
    flex: 1,
    alignItems: "center",
    gap: 8,
  },
  modeFlowNode: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
  },
  modeFlowCore: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  modeFlowLabel: {
    color: palette.inkSoft,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    fontFamily: fontFamily.body,
    textAlign: "center",
  },
  modeHeroDeep: {
    borderRadius: radius.xl,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 18,
    gap: 14,
    shadowColor: "#7CA2E8",
    shadowOpacity: 0.22,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  modeHeroStandard: {
    borderRadius: radius.xl,
    backgroundColor: "#F7FBFF",
    borderWidth: 1,
    borderColor: "#D7E6FC",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 18,
    gap: 14,
  },
  modeHeroTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  modeHeroBadge: {
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  modeHeroBadgeText: {
    color: "#F3F7FF",
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  modeHeroCount: {
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: "rgba(255,255,255,0.14)",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  modeHeroCountText: {
    color: "#F3F7FF",
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  modeHeroTitle: {
    color: "#FFFFFF",
    fontSize: 26,
    lineHeight: 30,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  modeHeroFlowRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  modeHeroFlowItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  modeHeroFlowChip: {
    borderRadius: radius.pill,
    paddingHorizontal: 11,
    paddingVertical: 8,
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  modeHeroFlowChipActive: {
    backgroundColor: "rgba(255,255,255,0.24)",
  },
  modeHeroFlowText: {
    color: "#F3F7FF",
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  modeHeroTagRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  modeHeroTag: {
    borderRadius: radius.md,
    paddingHorizontal: 11,
    paddingVertical: 8,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  modeHeroTagText: {
    color: "#F3F7FF",
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  modeHeroBadgeStandard: {
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: "#EAF2FF",
  },
  modeHeroBadgeStandardText: {
    color: "#2F70E6",
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  modeHeroCountStandard: {
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#DBE7FA",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  modeHeroCountStandardText: {
    color: "#2F70E6",
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  modeHeroTitleStandard: {
    color: palette.ink,
    fontSize: 24,
    lineHeight: 28,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  modeHeroFlowRowStandard: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  modeHeroFlowChipStandard: {
    borderRadius: radius.pill,
    paddingHorizontal: 11,
    paddingVertical: 8,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#D8E4F7",
  },
  modeHeroFlowChipStandardActive: {
    backgroundColor: "#2F70E6",
    borderColor: "#2F70E6",
  },
  modeHeroFlowTextStandard: {
    color: "#5B6880",
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  modeHeroFlowTextStandardActive: {
    color: "#FFFFFF",
  },
  modeHeroTagRowStandard: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  modeHeroTagStandard: {
    borderRadius: radius.md,
    paddingHorizontal: 11,
    paddingVertical: 8,
    backgroundColor: "#EEF5FF",
  },
  modeHeroTagStandardText: {
    color: "#2F70E6",
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  inputWrap: {
    flex: 1,
    borderRadius: radius.md,
    backgroundColor: palette.surfaceSoft,
    borderWidth: 1,
    borderColor: palette.line,
    padding: 12,
  },
  inputWrapDeep: {
    borderColor: "#C8DBFA",
    backgroundColor: "#F8FBFF",
    shadowColor: "#B4CBF2",
    shadowOpacity: 0.14,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  textInput: {
    flex: 1,
    color: palette.ink,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: fontFamily.body,
    minHeight: 150,
  },
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  modeSwitchShell: {
    flexDirection: "row",
    gap: 10,
    borderRadius: radius.lg,
    padding: 8,
    borderWidth: 1,
    borderColor: "#D7E6FC",
  },
  modeOption: {
    flex: 1,
    minHeight: 70,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: "rgba(255,255,255,0.78)",
    borderWidth: 1,
    borderColor: "rgba(214,228,250,0.92)",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    overflow: "hidden",
  },
  modeOptionActive: {
    borderColor: "#9DBBE3",
    shadowColor: "#ABC9F4",
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  modeOptionGlow: {
    ...StyleSheet.absoluteFillObject,
  },
  modeIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  modeLabel: {
    color: palette.inkSoft,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  modeLabelActive: {
    color: palette.ink,
  },
  actionChip: {
    minHeight: 40,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: palette.accentSoft,
  },
  chipPressed: {
    opacity: 0.88,
  },
  actionChipText: {
    color: palette.accentStrong,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  fileRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  fileBadge: {
    maxWidth: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: radius.pill,
    paddingLeft: 12,
    paddingRight: 8,
    paddingVertical: 8,
    backgroundColor: palette.surfaceSoft,
    borderWidth: 1,
    borderColor: palette.line,
  },
  fileBadgeText: {
    maxWidth: 180,
    color: palette.ink,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  fileBadgeRemove: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  previewEmpty: {
    flex: 1,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.surfaceSoft,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    minHeight: 230,
  },
  previewEmptyText: {
    color: palette.inkSoft,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  previewGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  previewTile: {
    width: "48%",
    aspectRatio: 1,
    borderRadius: radius.md,
    overflow: "hidden",
    backgroundColor: palette.surfaceSoft,
    position: "relative",
  },
  previewImage: {
    width: "100%",
    height: "100%",
  },
  videoTileFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#6B78A8",
  },
  videoTileOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  videoTilePlay: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(22, 34, 58, 0.48)",
  },
  videoNameBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: "rgba(18, 24, 38, 0.56)",
  },
  videoNameText: {
    color: "#FFFFFF",
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  previewRemove: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.82)",
  },
  previewMoreMask: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(35, 74, 120, 0.42)",
  },
  previewMoreText: {
    color: palette.inkInverse,
    fontSize: 18,
    lineHeight: 22,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  videoModalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(8, 12, 20, 0.62)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  videoModalCard: {
    width: "100%",
    maxWidth: 460,
    borderRadius: radius.xl,
    overflow: "hidden",
    backgroundColor: "#0F1728",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  videoModalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  videoModalTitle: {
    flex: 1,
    color: "#FFFFFF",
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  videoModalClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  videoModalPlayerWrap: {
    width: "100%",
    aspectRatio: 16 / 9,
    backgroundColor: "#000000",
  },
  videoModalPlayer: {
    width: "100%",
    height: "100%",
  },
  audioPanel: {
    flex: 1,
    minHeight: 180,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.surfaceSoft,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
    gap: 12,
  },
  audioFileName: {
    color: palette.ink,
    fontSize: 15,
    lineHeight: 21,
    textAlign: "center",
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  audioInsightButton: {
    minHeight: 54,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.surfaceSoft,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  audioInsightButtonDisabled: {
    opacity: 0.5,
  },
  audioInsightCopy: {
    flex: 1,
    gap: 4,
  },
  audioInsightTitle: {
    color: palette.ink,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  audioInsightMeta: {
    color: palette.inkSoft,
    fontSize: 11,
    lineHeight: 14,
    fontFamily: fontFamily.body,
  },
  audioInsightPreview: {
    gap: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.surfaceSoft,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  audioInsightPreviewBadge: {
    alignSelf: "flex-start",
    borderRadius: radius.pill,
    backgroundColor: palette.accentSoft,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  audioInsightPreviewBadgeText: {
    color: palette.accentStrong,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  audioInsightPreviewRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
  },
  audioInsightPreviewItem: {
    color: palette.ink,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  audioInsightPreviewDivider: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fontFamily.body,
  },
  resultBlock: {
    gap: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.surfaceSoft,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  resultBadge: {
    alignSelf: "flex-start",
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  resultBadgeText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  resultMetrics: {
    flexDirection: "row",
    gap: 10,
  },
  resultMetric: {
    flex: 1,
    borderRadius: radius.md,
    backgroundColor: palette.surface,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 4,
  },
  resultMetricLabel: {
    color: palette.inkSoft,
    fontSize: 11,
    lineHeight: 15,
    fontFamily: fontFamily.body,
  },
  resultMetricValue: {
    color: palette.ink,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  placeholderLine: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 17,
    fontFamily: fontFamily.body,
  },
});
