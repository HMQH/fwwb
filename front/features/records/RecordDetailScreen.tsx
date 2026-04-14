import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "@/features/auth";
import { detectionsApi, DetectionResultCard, EvidenceListCard } from "@/features/detections";
import type { DetectionSubmissionDetail } from "@/features/detections";
import { ApiError } from "@/shared/api";
import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";

import { recordsApi } from "./api";

function formatDateTime(value?: string | null) {
  if (!value) {
    return "--";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function AttachmentChips({ label, items }: { label: string; items: string[] }) {
  if (!items.length) {
    return null;
  }

  return (
    <View style={styles.attachmentGroup}>
      <Text style={styles.blockLabel}>{label}</Text>
      <View style={styles.attachmentWrap}>
        {items.map((item) => (
          <View key={item} style={styles.attachmentChip}>
            <Text style={styles.attachmentChipText} numberOfLines={1}>
              {item.split("/").pop() ?? item}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export default function RecordDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { token } = useAuth();
  const [detail, setDetail] = useState<DetectionSubmissionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDetail = useCallback(async () => {
    if (!token || !id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await recordsApi.detail(token, id);
      setDetail(response);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "加载详情失败，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }, [id, token]);

  useFocusEffect(
    useCallback(() => {
      void loadDetail();
    }, [loadDetail])
  );

  const handleRerun = useCallback(async () => {
    if (!token || !id) {
      return;
    }
    try {
      await detectionsApi.rerun(token, id);
      await loadDetail();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "重新检测失败，请稍后再试。");
    }
  }, [id, loadDetail, token]);

  const submission = detail?.submission;
  const result = detail?.latest_result;
  const job = detail?.latest_job;

  const stageTags = useMemo(() => result?.stage_tags ?? [], [result?.stage_tags]);

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.topBar}>
            <Pressable style={({ pressed }) => [styles.backButton, pressed && styles.buttonPressed]} onPress={() => router.back()}>
              <MaterialCommunityIcons name="chevron-left" size={18} color={palette.accentStrong} />
              <Text style={styles.backButtonText}>返回记录</Text>
            </Pressable>
          </View>

          <View style={styles.headerCard}>
            <Text style={styles.pageTitle}>检测详情</Text>
            <Text style={styles.pageSubtitle}>查看原文、结构化结论、黑白样本证据与建议动作。</Text>
          </View>

          {loading ? (
            <View style={styles.loadingCard}>
              <ActivityIndicator size="small" color={palette.accentStrong} />
              <Text style={styles.loadingText}>正在加载详情…</Text>
            </View>
          ) : error ? (
            <View style={styles.errorCard}>
              <Text style={styles.errorTitle}>详情加载失败</Text>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : !detail || !submission ? (
            <View style={styles.errorCard}>
              <Text style={styles.errorTitle}>找不到这条记录</Text>
              <Text style={styles.errorText}>记录可能已删除，或你没有权限访问。</Text>
            </View>
          ) : (
            <>
              <View style={styles.metaCard}>
                <View style={styles.metaRow}>
                  <View style={styles.metaBlock}>
                    <Text style={styles.blockLabel}>提交时间</Text>
                    <Text style={styles.blockValue}>{formatDateTime(submission.created_at)}</Text>
                  </View>
                  <View style={styles.metaBlock}>
                    <Text style={styles.blockLabel}>任务状态</Text>
                    <Text style={styles.blockValue}>{job?.status ?? "--"}</Text>
                  </View>
                </View>
                {stageTags.length ? (
                  <View style={styles.stageWrap}>
                    {stageTags.map((tag) => (
                      <View key={tag} style={styles.stageChip}>
                        <Text style={styles.stageChipText}>{tag}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>

              <DetectionResultCard result={result} job={job} onRerun={handleRerun} />

              <View style={styles.sectionCard}>
                <Text style={styles.sectionTitle}>原始文本</Text>
                <Text style={styles.sectionHint}>系统真正参与规则分析与 RAG 检索的文本内容。</Text>
                <Text style={styles.rawText}>{submission.text_content?.trim() || "当前没有可分析文本，可能只提交了附件。"}</Text>
              </View>

              <View style={styles.sectionCard}>
                <Text style={styles.sectionTitle}>附件留档</Text>
                <Text style={styles.sectionHint}>文件不会直接进入当前文本 RAG 判定，但会保存在记录里供复核。</Text>
                <AttachmentChips label="文本文件" items={submission.text_paths} />
                <AttachmentChips label="图片" items={submission.image_paths} />
                <AttachmentChips label="音频" items={submission.audio_paths} />
                <AttachmentChips label="视频" items={submission.video_paths} />
                {!submission.text_paths.length && !submission.image_paths.length && !submission.audio_paths.length && !submission.video_paths.length ? (
                  <Text style={styles.sectionHint}>这次没有上传附件。</Text>
                ) : null}
              </View>

              <EvidenceListCard title="黑样本证据" subtitle="这些历史诈骗样本支撑了当前判断。" items={result?.retrieved_evidence ?? []} tone="black" />
              <EvidenceListCard title="白样本对照" subtitle="这些正常样本用于帮助系统压低误报。" items={result?.counter_evidence ?? []} tone="white" />

              {result?.advice?.length ? (
                <View style={styles.sectionCard}>
                  <Text style={styles.sectionTitle}>建议动作</Text>
                  <View style={styles.adviceList}>
                    {result.advice.map((item) => (
                      <View key={item} style={styles.adviceRow}>
                        <View style={styles.adviceDot} />
                        <Text style={styles.adviceText}>{item}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}
            </>
          )}
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
  topBar: {
    flexDirection: "row",
    justifyContent: "flex-start",
  },
  backButton: {
    minHeight: 40,
    borderRadius: radius.pill,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  backButtonText: {
    color: palette.accentStrong,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  headerCard: {
    borderRadius: radius.xl,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 18,
    paddingVertical: 18,
    gap: 4,
    ...panelShadow,
  },
  pageTitle: {
    color: palette.ink,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  pageSubtitle: {
    color: palette.inkSoft,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: fontFamily.body,
  },
  loadingCard: {
    borderRadius: radius.lg,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    paddingVertical: 24,
    alignItems: "center",
    gap: 10,
    ...panelShadow,
  },
  loadingText: {
    color: palette.inkSoft,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  errorCard: {
    borderRadius: radius.lg,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: "#F0C9BE",
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 6,
    ...panelShadow,
  },
  errorTitle: {
    color: palette.ink,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  errorText: {
    color: palette.inkSoft,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  metaCard: {
    borderRadius: radius.lg,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 12,
    ...panelShadow,
  },
  metaRow: {
    flexDirection: "row",
    gap: 12,
  },
  metaBlock: {
    flex: 1,
    gap: 4,
  },
  blockLabel: {
    color: palette.inkSoft,
    fontSize: 11,
    lineHeight: 14,
    fontFamily: fontFamily.body,
  },
  blockValue: {
    color: palette.ink,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  stageWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  stageChip: {
    borderRadius: radius.pill,
    backgroundColor: palette.accentSoft,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  stageChipText: {
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
  rawText: {
    color: palette.ink,
    fontSize: 13,
    lineHeight: 21,
    fontFamily: fontFamily.body,
  },
  attachmentGroup: {
    gap: 8,
  },
  attachmentWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  attachmentChip: {
    maxWidth: "100%",
    borderRadius: radius.pill,
    backgroundColor: palette.surfaceSoft,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  attachmentChipText: {
    maxWidth: 260,
    color: palette.ink,
    fontSize: 11,
    lineHeight: 14,
    fontFamily: fontFamily.body,
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
