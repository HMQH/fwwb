import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { LinearGradient } from "expo-linear-gradient";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useFocusEffect } from "@react-navigation/native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  Alert,
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

import { consumeSelectedUploadedAudioDraft } from "../audio-selection-session";
import { buildDetectionSubmitFormData, detectionsApi } from "../api";
import { resolveDetectionFeaturePreset } from "../config/presets";
import type { AudioVerifyResponse, DetectionMode, PickedFile } from "../types";

type PreviewFile = PickedFile & { key: string };

function nextKey() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatPercent(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "--";
  }
  return `${Math.round(value * 100)}%`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDetectionJob(token: string, jobId: string) {
  let latest = await detectionsApi.getJob(token, jobId);
  const startedAt = Date.now();

  while (
    (latest.status === "pending" || latest.status === "running")
    && Date.now() - startedAt < 90_000
  ) {
    await sleep(1200);
    latest = await detectionsApi.getJob(token, jobId);
  }

  if (latest.status === "failed") {
    throw new ApiError(500, latest.error_message || "检测任务失败", null);
  }

  return latest;
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
}: {
  files: PreviewFile[];
  onRemove: (key: string) => void;
}) {
  const visibleFiles = files.slice(0, 4);

  if (!visibleFiles.length) {
    return (
      <View style={styles.previewEmpty}>
        <MaterialCommunityIcons
          name="image-outline"
          size={28}
          color={palette.inkSoft}
        />
        <Text style={styles.previewEmptyText}>图片预览</Text>
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

function AudioResultBlock({ result }: { result: AudioVerifyResponse }) {
  const isFake = String(result.label).toLowerCase() === "fake";

  return (
    <View style={styles.resultBlock}>
      <View
        style={[
          styles.resultBadge,
          { backgroundColor: isFake ? "#FFF0F0" : "#EDF8F1" },
        ]}
      >
        <Text
          style={[
            styles.resultBadgeText,
            { color: isFake ? "#D9485F" : "#1E8E5A" },
          ]}
        >
          {isFake ? "疑似AI音频" : "真人音频"}
        </Text>
      </View>

      <View style={styles.resultMetrics}>
        <View style={styles.resultMetric}>
          <Text style={styles.resultMetricLabel}>伪造概率</Text>
          <Text style={styles.resultMetricValue}>
            {formatPercent(result.fake_prob)}
          </Text>
        </View>
        <View style={styles.resultMetric}>
          <Text style={styles.resultMetricLabel}>真实概率</Text>
          <Text style={styles.resultMetricValue}>
            {formatPercent(result.genuine_prob)}
          </Text>
        </View>
      </View>
    </View>
  );
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

function TextModeHero({
  deepReasoning,
  textFileCount,
  hasTextContent,
}: {
  deepReasoning: boolean;
  textFileCount: number;
  hasTextContent: boolean;
}) {
  const flow = deepReasoning
    ? ["原文", "关系", "证据", "判定"]
    : ["原文", "规则", "检索", "结果"];
  const tags = deepReasoning
    ? ["KAG", "风险链", "反证", "图谱"]
    : ["FAST", "规则", "相似", "结果"];
  const title = deepReasoning ? "关系图谱" : "规则检索";
  const countLabel = `${textFileCount}${hasTextContent ? "+1" : ""}`;

  if (deepReasoning) {
    return (
      <LinearGradient
        colors={["#163A70", "#2859A8", "#6B98F7"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.modeHeroDeep}
      >
        <View style={styles.modeHeroTop}>
          <View style={styles.modeHeroBadge}>
            <Text style={styles.modeHeroBadgeText}>KAG</Text>
          </View>
          <View style={styles.modeHeroCount}>
            <MaterialCommunityIcons name="file-document-multiple-outline" size={14} color="#F3F7FF" />
            <Text style={styles.modeHeroCountText}>{countLabel}</Text>
          </View>
        </View>

        <Text style={styles.modeHeroTitle}>{title}</Text>

        <View style={styles.modeHeroFlowRow}>
          {flow.map((item, index) => (
            <View key={item} style={styles.modeHeroFlowItem}>
              <View
                style={[
                  styles.modeHeroFlowChip,
                  index === flow.length - 1 && styles.modeHeroFlowChipActive,
                ]}
              >
                <Text style={styles.modeHeroFlowText}>{item}</Text>
              </View>
              {index < flow.length - 1 ? (
                <MaterialCommunityIcons name="arrow-right" size={14} color="rgba(243,247,255,0.76)" />
              ) : null}
            </View>
          ))}
        </View>

        <View style={styles.modeHeroTagRow}>
          {tags.map((item) => (
            <View key={item} style={styles.modeHeroTag}>
              <Text style={styles.modeHeroTagText}>{item}</Text>
            </View>
          ))}
        </View>
      </LinearGradient>
    );
  }

  return (
    <View style={styles.modeHeroStandard}>
      <View style={styles.modeHeroTop}>
        <View style={styles.modeHeroBadgeStandard}>
          <Text style={styles.modeHeroBadgeStandardText}>FAST</Text>
        </View>
        <View style={styles.modeHeroCountStandard}>
          <MaterialCommunityIcons name="file-document-multiple-outline" size={14} color="#2F70E6" />
          <Text style={styles.modeHeroCountStandardText}>{countLabel}</Text>
        </View>
      </View>

      <Text style={styles.modeHeroTitleStandard}>{title}</Text>

      <View style={styles.modeHeroFlowRowStandard}>
        {flow.map((item, index) => (
          <View key={item} style={styles.modeHeroFlowItem}>
            <View
              style={[
                styles.modeHeroFlowChipStandard,
                index === flow.length - 1 && styles.modeHeroFlowChipStandardActive,
              ]}
            >
              <Text
                style={[
                  styles.modeHeroFlowTextStandard,
                  index === flow.length - 1 && styles.modeHeroFlowTextStandardActive,
                ]}
              >
                {item}
              </Text>
            </View>
            {index < flow.length - 1 ? (
              <MaterialCommunityIcons name="arrow-right" size={14} color="#8DA7D3" />
            ) : null}
          </View>
        ))}
      </View>

      <View style={styles.modeHeroTagRowStandard}>
        {tags.map((item) => (
          <View key={item} style={styles.modeHeroTagStandard}>
            <Text style={styles.modeHeroTagStandardText}>{item}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export function DetectionModeScreen({ mode }: { mode: DetectionMode }) {
  const router = useRouter();
  const { feature } = useLocalSearchParams<{ feature?: string }>();
  const { token } = useAuth();
  const preset = resolveDetectionFeaturePreset(mode, feature);

  const [textContent, setTextContent] = useState("");
  const [textFiles, setTextFiles] = useState<PreviewFile[]>([]);
  const [imageFiles, setImageFiles] = useState<PreviewFile[]>([]);
  const [audioFile, setAudioFile] = useState<PreviewFile | null>(null);
  const [audioResult, setAudioResult] = useState<AudioVerifyResponse | null>(null);
  const [deepReasoning, setDeepReasoning] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const isTextMode = mode === "text";
  const isVisualMode = mode === "visual";
  const isAudioMode = mode === "audio";

  const hasTextPayload = Boolean(textContent.trim()) || textFiles.length > 0;
  const hasVisualPayload = imageFiles.length > 0;
  const canSubmit =
    (isTextMode && hasTextPayload) ||
    (isVisualMode && hasVisualPayload) ||
    (isAudioMode && Boolean(audioFile));

  const mergeVisualFile = useCallback((file: PickedFile) => {
    setImageFiles((prev) => {
      if (prev.some((item) => item.uri === file.uri)) {
        return prev;
      }
      return [...prev, { ...file, key: nextKey() }];
    });
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!isVisualMode) {
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
    }, [isVisualMode, mergeVisualFile]),
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

      setSubmitting(true);
      void detectionsApi
        .submitAudioVerifyRecordFromUploads(token, {
          audio_paths: draft.items.map((item) => item.file_path),
        })
        .then(async (response) => {
          await waitForDetectionJob(token, response.job.id);
          setAudioFile(null);
          setAudioResult(null);
          router.replace({
            pathname: "/records/[id]",
            params: { id: response.submission.id },
          });
        })
        .catch((error) => {
          const message =
            error instanceof ApiError ? error.message : "音频记录提交失败";
          Alert.alert("提交失败", message);
        })
        .finally(() => {
          setSubmitting(false);
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
    setAudioResult(null);
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

  const handleSubmit = useCallback(async () => {
    if (!token) {
      Alert.alert("未登录", "请先登录");
      return;
    }

    if (isAudioMode) {
      if (!audioFile) {
        void pickAudio();
        return;
      }
      setSubmitting(true);
      try {
        const formData = buildDetectionSubmitFormData({
          audio_files: [audioFile],
        });
        const response = await detectionsApi.submit(token, formData);
        await waitForDetectionJob(token, response.job.id);
        setAudioFile(null);
        setAudioResult(null);
        router.replace({
          pathname: "/records/[id]",
          params: { id: response.submission.id },
        });
      } catch (error) {
        const message =
          error instanceof ApiError ? error.message : "音频鉴别失败";
        Alert.alert("识别失败", message);
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (!canSubmit) {
      Alert.alert("缺少内容", "请先添加检测材料");
      return;
    }

    const formData = buildDetectionSubmitFormData({
      text_content: textContent,
      deep_reasoning: deepReasoning,
      text_files: textFiles,
      image_files: imageFiles,
    });

    setSubmitting(true);
    try {
      const response = await detectionsApi.submit(token, formData);
      setTextContent("");
      setTextFiles([]);
      setImageFiles([]);
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
  }, [audioFile, canSubmit, deepReasoning, imageFiles, isAudioMode, pickAudio, router, textContent, textFiles, token]);

  const primaryLabel = useMemo(() => {
    if (isAudioMode) {
      if (!audioFile) {
        return "上传音频";
      }
      return audioResult ? "重新上传" : preset.buttonLabel;
    }
    if (isTextMode && deepReasoning) {
      return "开始KAG";
    }
    if (isTextMode) {
      return "开始检测";
    }
    return preset.buttonLabel;
  }, [audioFile, audioResult, deepReasoning, isAudioMode, isTextMode, preset.buttonLabel]);

  const handlePrimaryPress = useCallback(() => {
    if (isAudioMode && (!audioFile || audioResult)) {
      void pickAudio();
      return;
    }
    void handleSubmit();
  }, [audioFile, audioResult, handleSubmit, isAudioMode, pickAudio]);

  return (
    <TaskScreen
      title={preset.title}
      cardStyle={isTextMode && deepReasoning ? styles.taskCardDeep : undefined}
      footer={
        <TaskPrimaryButton
          label={primaryLabel}
          onPress={handlePrimaryPress}
          disabled={!isAudioMode && !canSubmit}
          loading={submitting}
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
                    label={deepReasoning ? "KAG" : "普通"}
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
                  <MetaChip icon="image-multiple-outline" label={`${imageFiles.length} 图片`} tone="blue" />
                  <MetaChip
                    icon={imageFiles.length ? "check-circle-outline" : "image-off-outline"}
                    label={imageFiles.length ? "已选择" : "未选择"}
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

            <TextModeHero
              deepReasoning={deepReasoning}
              textFileCount={textFiles.length}
              hasTextContent={Boolean(textContent.trim())}
            />

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
            <PreviewGrid files={imageFiles} onRemove={removeImageFile} />

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
                {audioFile?.name ?? "未上传音频"}
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

            {audioResult ? <AudioResultBlock result={audioResult} /> : null}

            {!audioResult ? (
              <Text style={styles.placeholderLine}>本地鉴别</Text>
            ) : null}
          </>
        ) : null}
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
