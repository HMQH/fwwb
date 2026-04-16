import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "@/features/auth";
import { consumeStagedFloatingCapture, floatingCaptureService } from "@/features/floating-capture";
import { relationsApi } from "@/features/relations/api";
import { relationTypeMeta, type RelationProfileSummary } from "@/features/relations/types";
import { ApiError } from "@/shared/api";
import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";

import { buildDetectionSubmitFormData, detectionsApi } from "../api";
import { DetectionPipelineCard } from "../components/DetectionPipelineCard";
import { DetectionResultCard } from "../components/DetectionResultCard";
import { EvidenceListCard } from "../components/EvidenceListCard";
import { ReasoningGraphCard } from "../components/ReasoningGraphCard";
import type { DetectionJob, DetectionMode, DetectionSubmissionDetail, PickedFile } from "../types";

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
    tags: ["文本", "RAG", "图谱"],
    allow: { text: true, textFiles: true, image: false, video: false, audio: false },
  },
  visual: {
    title: "图像 / 视频",
    icon: "image-search-outline",
    tags: ["截图", "视频", "归档"],
    allow: { text: true, textFiles: false, image: true, video: true, audio: false },
  },
  audio: {
    title: "音频检测",
    icon: "microphone-outline",
    tags: ["音频", "摘要", "文本"],
    allow: { text: true, textFiles: false, image: false, video: false, audio: true },
  },
  mixed: {
    title: "混合检测",
    icon: "layers-triple-outline",
    tags: ["混合", "RAG", "归档"],
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
  actions?: React.ReactNode;
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

export function DetectionModeScreen({ mode }: { mode: DetectionMode }) {
  const router = useRouter();
  const { token, refreshCurrentUser } = useAuth();
  const config = modeConfig[mode];

  const [textContent, setTextContent] = useState("");
  const [textFiles, setTextFiles] = useState<AppendixItem[]>([]);
  const [audioFiles, setAudioFiles] = useState<AppendixItem[]>([]);
  const [imageFiles, setImageFiles] = useState<AppendixItem[]>([]);
  const [videoFiles, setVideoFiles] = useState<AppendixItem[]>([]);
  const [relations, setRelations] = useState<RelationProfileSummary[]>([]);
  const [relationsLoading, setRelationsLoading] = useState(false);
  const [selectedRelationId, setSelectedRelationId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [activeJob, setActiveJob] = useState<DetectionJob | null>(null);
  const [detail, setDetail] = useState<DetectionSubmissionDetail | null>(null);

  const activeSubmissionId = activeJob?.submission_id ?? detail?.submission.id ?? null;
  const currentResult = activeJob?.result ?? detail?.latest_result ?? null;

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
        Alert.alert("部分文件未添加", invalid.join("\n"));
      }
      if (valid.length) {
        setter((prev) => [...prev, ...valid]);
      }
    },
    [],
  );

  const pickDocumentsForSlot = useCallback(
    async (slot: Extract<AppendixSlot, "text" | "audio" | "video">, setter: Dispatch<SetStateAction<AppendixItem[]>>) => {
      if (Platform.OS === "web") {
        Alert.alert("当前平台受限", "请在手机端选择文件");
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
      Alert.alert("当前平台受限", "请在手机端选择文件");
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

  const pickVideos = useCallback(async () => {
    if (Platform.OS === "web") {
      Alert.alert("当前平台受限", "请在手机端选择文件");
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
    return Boolean(textContent.trim()) || textFiles.length > 0 || audioFiles.length > 0 || imageFiles.length > 0 || videoFiles.length > 0;
  }, [audioFiles.length, imageFiles.length, textContent, textFiles.length, videoFiles.length]);
  const selectedRelation = useMemo(
    () => relations.find((item) => item.id === selectedRelationId) ?? null,
    [relations, selectedRelationId]
  );

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
      // silent
    }
  }, [activeSubmissionId, token]);

  const consumeFloatingCapture = useCallback(async () => {
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
      return;
    }

    setImageFiles((prev) => {
      if (prev.some((item) => item.uri === captured.uri)) {
        return prev;
      }

      return [...prev, { ...captured, key: nextKey() }];
    });

    Alert.alert("截图已带回", "悬浮截图已加入图片素材，你可以继续补充内容后再开始检测。");
  }, [config.allow.image]);

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
      // ignore relation loading failure, detection can still continue
    } finally {
      setRelationsLoading(false);
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      void consumeFloatingCapture();
      void loadRelations();
    }, [consumeFloatingCapture, loadRelations])
  );

  const handleSubmit = useCallback(async () => {
    if (!token) {
      Alert.alert("未登录", "请先登录");
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
      setActiveJob(response.job);
      setDetail({
        submission: response.submission,
        latest_job: response.job,
        latest_result: response.job.result,
        content_preview: response.submission.text_content?.slice(0, 88) ?? null,
      });
      resetForm();
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "提交失败，请稍后重试";
      Alert.alert("提交失败", message);
    } finally {
      setSubmitting(false);
    }
  }, [audioFiles, hasPayload, imageFiles, resetForm, textContent, textFiles, token, videoFiles]);

  const handleRerun = useCallback(async () => {
    if (!token || !activeSubmissionId) {
      return;
    }
    try {
      const job = await detectionsApi.rerun(token, activeSubmissionId);
      setActiveJob(job);
      setDetail((prev) => (prev ? { ...prev, latest_job: job, latest_result: job.result } : prev));
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "无法重跑，请稍后重试";
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
        void refreshCurrentUser();
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
            : prev,
        );
        if (latestJob.status === "completed") {
          void refreshDetail();
          void refreshCurrentUser();
        }
      } catch {
        // ignore
      }
    }, 2200);

    return () => clearTimeout(timer);
  }, [activeJob, refreshCurrentUser, refreshDetail, token]);

  const materialCount = textFiles.length + audioFiles.length + imageFiles.length + videoFiles.length + (textContent.trim() ? 1 : 0);

  return (
    <View style={styles.root}>
      <View style={styles.backgroundOrbTop} />
      <View style={styles.backgroundOrbBottom} />
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
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
                  {selectedRelation ? (
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
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.relationChipRow}
              >
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
                  <Text style={styles.emptyTileText}>暂无关系对象</Text>
                )}
              </View>
            )}
          </View>

          {config.allow.text ? (
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

          {config.allow.textFiles ? (
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
                    {mode === "visual" ? (
                      <Pressable
                        style={({ pressed }) => [styles.addButton, pressed && styles.buttonPressed]}
                        onPress={() => router.push("/detect-ai-face")}
                      >
                        <MaterialCommunityIcons name="face-recognition" size={16} color={palette.accentStrong} />
                        <Text style={styles.addButtonText}>AI换脸</Text>
                      </Pressable>
                    ) : null}
                  </View>
                }
              />
              <PreviewGrid items={imageFiles} onRemove={(key) => setImageFiles((prev) => prev.filter((item) => item.key !== key))} />
            </View>
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
                title="音频"
                count={audioFiles.length}
                actions={
                  <Pressable style={({ pressed }) => [styles.addButton, pressed && styles.buttonPressed]} onPress={() => void pickDocumentsForSlot("audio", setAudioFiles)}>
                    <MaterialCommunityIcons name="microphone-plus" size={16} color={palette.accentStrong} />
                    <Text style={styles.addButtonText}>添加</Text>
                  </Pressable>
                }
              />
              <PreviewGrid items={audioFiles} onRemove={(key) => setAudioFiles((prev) => prev.filter((item) => item.key !== key))} />
            </View>
          ) : null}

          <View style={styles.commandCard}>
            <View style={styles.commandStatsRow}>
              <CountPill label="文本" value={textContent.trim() ? 1 : 0} />
              <CountPill label="附件" value={textFiles.length + audioFiles.length + imageFiles.length + videoFiles.length} />
              <CountPill label="材料" value={materialCount} />
            </View>
            <Pressable
              style={({ pressed }) => [styles.submitButton, pressed && !submitting && styles.buttonPressed, (!hasPayload || submitting) && styles.submitDisabled]}
              onPress={() => void handleSubmit()}
              disabled={!hasPayload || submitting}
            >
              <Text style={styles.submitButtonText}>{submitting ? "提交中" : "开始检测"}</Text>
              <MaterialCommunityIcons name="arrow-right" size={16} color={palette.inkInverse} />
            </Pressable>
          </View>

          {(activeJob || currentResult) ? <DetectionPipelineCard job={activeJob} result={currentResult} /> : null}

          {currentResult ? (
            <>
              <DetectionResultCard result={currentResult} job={activeJob} onOpenDetail={activeSubmissionId ? openDetail : undefined} onRerun={activeSubmissionId ? handleRerun : undefined} />
              <ReasoningGraphCard result={currentResult} />
              {currentResult.retrieved_evidence.length ? <EvidenceListCard title="风险参照" items={currentResult.retrieved_evidence} tone="black" /> : null}
              {currentResult.counter_evidence.length ? <EvidenceListCard title="安全参照" items={currentResult.counter_evidence} tone="white" /> : null}
              {currentResult.advice.length ? (
                <View style={styles.sectionCard}>
                  <Text style={styles.sectionTitle}>建议</Text>
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
            </>
          ) : null}
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
  commandStatsRow: { flexDirection: "row", gap: 10 },
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
  submitButtonText: {
    color: palette.inkInverse,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  submitDisabled: { opacity: 0.55 },
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
