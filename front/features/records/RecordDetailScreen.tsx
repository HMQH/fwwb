import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "@/features/auth";
import {
  DetectionPipelineCard,
  ReasoningGraphCard,
  detectionsApi,
  formatConfidence,
  getResultHeadline,
  getRiskMeta,
  getVisibleFraudType,
} from "@/features/detections";
import { guardiansApi } from "@/features/guardians";
import type { DetectionEvidence, DetectionSubmissionDetail } from "@/features/detections";
import { resolveEvidencePreviewUrl } from "@/features/detections/evidencePreview";
import { ApiError } from "@/shared/api";
import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";

import { recordsApi } from "./api";

const DETAIL_PAGES = [
  { key: "overview", label: "总览" },
  { key: "graph", label: "图谱" },
  { key: "materials", label: "材料" },
] as const;
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

function getJobStatusLabel(status?: string | null) {
  if (status === "completed") {
    return "完成";
  }
  if (status === "failed") {
    return "失败";
  }
  if (status === "running") {
    return "运行中";
  }
  if (status === "pending") {
    return "排队中";
  }
  return "待处理";
}

function getGuardianNotifyStatusLabel(status?: string | null) {
  if (status === "read") {
    return "已查看";
  }
  if (status === "sent") {
    return "已通知";
  }
  if (status === "failed") {
    return "发送失败";
  }
  return "待发送";
}

function getPageIndex(event: NativeSyntheticEvent<NativeScrollEvent>, width: number) {
  if (width <= 0) {
    return 0;
  }
  return Math.max(0, Math.round(event.nativeEvent.contentOffset.x / width));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toFiniteNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizePercentValue(value: unknown) {
  const parsed = toFiniteNumber(value);
  if (parsed === null) {
    return null;
  }
  const normalized = parsed >= 0 && parsed <= 1 ? parsed * 100 : parsed;
  return Math.max(0, Math.min(100, normalized));
}

function getResultScore(detail?: DetectionSubmissionDetail | null) {
  const raw = detail?.latest_result?.result_detail;
  const progressDetail = detail?.latest_job?.progress_detail;

  const candidates: unknown[] = [];
  if (isRecord(raw)) {
    candidates.push(raw.final_score);
    if (isRecord(raw.score_breakdown)) {
      candidates.push(raw.score_breakdown.final_score);
      candidates.push(raw.score_breakdown.base_score);
    }
    if (isRecord(raw.reasoning_graph) && isRecord(raw.reasoning_graph.summary_metrics)) {
      candidates.push(raw.reasoning_graph.summary_metrics.final_score);
    }
  }
  if (isRecord(progressDetail)) {
    candidates.push(progressDetail.final_score);
  }
  candidates.push(detail?.latest_result?.confidence);

  let zeroFallback: number | null = null;
  for (const candidate of candidates) {
    const normalized = normalizePercentValue(candidate);
    if (normalized !== null) {
      const rounded = Math.round(normalized);
      if (rounded > 0) {
        return rounded;
      }
      zeroFallback = 0;
    }
  }
  return zeroFallback;
}

function getSimilarityPercent(value?: number | null) {
  const normalized = normalizePercentValue(value);
  return normalized === null ? "--" : Math.round(normalized);
}

function InlinePill({
  label,
  soft,
  tone,
  icon,
}: {
  label: string;
  soft?: string;
  tone?: string;
  icon?: keyof typeof MaterialCommunityIcons.glyphMap;
}) {
  return (
    <View style={[styles.inlinePill, soft ? { backgroundColor: soft } : null]}>
      {icon ? <MaterialCommunityIcons name={icon} size={14} color={tone ?? palette.accentStrong} /> : null}
      <Text style={[styles.inlinePillText, tone ? { color: tone } : null]}>{label}</Text>
    </View>
  );
}

function MetricChip({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={styles.metricChip}>
      <Text style={styles.metricChipLabel}>{label}</Text>
      <Text style={styles.metricChipValue}>{value}</Text>
    </View>
  );
}

function PageSurface({
  children,
  soft = false,
}: {
  children: ReactNode;
  soft?: boolean;
}) {
  return (
    <View style={[styles.pageSurface, soft && styles.pageSurfaceSoft]}>
      {children}
    </View>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

function AttachmentChips({ items }: { items: string[] }) {
  if (!items.length) {
    return null;
  }
  return (
    <View style={styles.attachmentWrap}>
      {items.map((item) => (
        <View key={item} style={styles.attachmentChip}>
          <Text style={styles.attachmentChipText} numberOfLines={1}>
            {item.split("/").pop() ?? item}
          </Text>
        </View>
      ))}
    </View>
  );
}

function EmptyState({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <View style={styles.emptyCard}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {description ? <Text style={styles.emptyText}>{description}</Text> : null}
    </View>
  );
}

type EvidenceTone = "black" | "white";

type EvidenceSheetState = {
  item: DetectionEvidence;
  title: string;
  tone: EvidenceTone;
} | null;

function EvidenceCarouselSection({
  title,
  items,
  tone,
  cardWidth,
  onPressItem,
  onRailTouchStart,
  onRailTouchEnd,
}: {
  title: string;
  items: DetectionEvidence[];
  tone: EvidenceTone;
  cardWidth: number;
  onPressItem: (item: DetectionEvidence, title: string, tone: EvidenceTone) => void;
  onRailTouchStart: () => void;
  onRailTouchEnd: () => void;
}) {
  if (!items.length) {
    return null;
  }

  const theme =
    tone === "black"
      ? { soft: "#FFF3EE", ink: "#C1664A" }
      : { soft: "#EDF6FF", ink: palette.accentStrong };

  return (
    <PageSurface soft>
      <SectionLabel>{title}</SectionLabel>
      <ScrollView
        horizontal
        nestedScrollEnabled
        directionalLockEnabled
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.evidenceRail}
        onTouchStart={onRailTouchStart}
        onTouchEnd={onRailTouchEnd}
        onTouchCancel={onRailTouchEnd}
        onScrollBeginDrag={onRailTouchStart}
        onScrollEndDrag={onRailTouchEnd}
        onMomentumScrollEnd={onRailTouchEnd}
        scrollEventThrottle={16}
      >
        {items.map((item) => {
          const previewUrl = resolveEvidencePreviewUrl(item);

          return (
            <Pressable
              key={`${item.source_id}-${item.chunk_index}-${item.sample_label}`}
              style={({ pressed }) => [
                styles.evidenceCard,
                { width: cardWidth },
                pressed && styles.evidenceCardPressed,
              ]}
              onPress={() => onPressItem(item, title, tone)}
            >
              <View style={styles.evidenceCardTop}>
                <View style={styles.evidenceTagRow}>
                  <View style={[styles.evidenceBadge, { backgroundColor: theme.soft }]}>
                    <Text style={[styles.evidenceBadgeText, { color: theme.ink }]}>{title}</Text>
                  </View>
                  {item.fraud_type ? (
                    <View style={styles.evidenceTypeChip}>
                      <Text style={styles.evidenceTypeChipText} numberOfLines={1}>
                        {item.fraud_type}
                      </Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.evidenceScore}>{getSimilarityPercent(item.similarity_score)}</Text>
              </View>

              {previewUrl ? (
                <Image
                  source={{ uri: previewUrl }}
                  style={styles.evidencePreviewImage}
                  contentFit="cover"
                  transition={120}
                />
              ) : null}

              <Text style={styles.evidencePreviewText} numberOfLines={previewUrl ? 4 : 5}>
                {item.chunk_text}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </PageSurface>
  );
}

export default function RecordDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { token } = useAuth();
  const { width } = useWindowDimensions();
  const pagerRef = useRef<FlatList<(typeof DETAIL_PAGES)[number]> | null>(null);

  const [detail, setDetail] = useState<DetectionSubmissionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notifyingGuardian, setNotifyingGuardian] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [pagerScrollEnabled, setPagerScrollEnabled] = useState(true);
  const [evidenceSheet, setEvidenceSheet] = useState<EvidenceSheetState>(null);
  const evidenceSheetScale = useRef(new Animated.Value(0.92)).current;
  const evidenceSheetOpacity = useRef(new Animated.Value(0)).current;

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
      setError(err instanceof ApiError ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [id, token]);

  useFocusEffect(
    useCallback(() => {
      void loadDetail();
    }, [loadDetail]),
  );

  const handleRerun = useCallback(async () => {
    if (!token || !id) {
      return;
    }
    try {
      await detectionsApi.rerun(token, id);
      await loadDetail();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "重跑失败");
    }
  }, [id, loadDetail, token]);

  const handleNotifyGuardian = useCallback(async () => {
    if (!token || !id || notifyingGuardian) {
      return;
    }
    setNotifyingGuardian(true);
    try {
      const events = await guardiansApi.createEvents({ submission_id: id }, token);
      await loadDetail();
      const firstEvent = events[0];
      if (firstEvent) {
        router.push({
          pathname: "/guardians/events/[id]" as never,
          params: { id: firstEvent.id } as never,
        });
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "通知监护人失败");
    } finally {
      setNotifyingGuardian(false);
    }
  }, [id, loadDetail, notifyingGuardian, router, token]);

  const submission = detail?.submission;
  const result = detail?.latest_result;
  const job = detail?.latest_job;
  const guardianEventSummary = detail?.guardian_event_summary;

  useEffect(() => {
    if (!token || !id) {
      return;
    }
    if (job?.status !== "pending" && job?.status !== "running") {
      return;
    }
    const timer = setTimeout(() => {
      void loadDetail();
    }, 2200);
    return () => clearTimeout(timer);
  }, [id, job?.status, job?.updated_at, loadDetail, token]);

  const riskMeta = getRiskMeta(result?.risk_level);
  const headline = getResultHeadline(result);
  const visibleFraudType = getVisibleFraudType(result);
  const score = getResultScore(detail);
  const evidenceCardWidth = Math.max(220, Math.min(width - 92, 296));
  const evidenceSheetImageUrl = evidenceSheet ? resolveEvidencePreviewUrl(evidenceSheet.item) : null;

  const onPressPage = useCallback((index: number) => {
    setPageIndex(index);
    pagerRef.current?.scrollToIndex({ index, animated: true });
  }, []);

  const onMomentumScrollEnd = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    setPageIndex(getPageIndex(event, width));
  }, [width]);

  const openEvidenceSheet = useCallback((item: DetectionEvidence, title: string, tone: EvidenceTone) => {
    setPagerScrollEnabled(true);
    evidenceSheetScale.setValue(0.92);
    evidenceSheetOpacity.setValue(0);
    setEvidenceSheet({ item, title, tone });
    requestAnimationFrame(() => {
      Animated.parallel([
        Animated.spring(evidenceSheetScale, {
          toValue: 1,
          useNativeDriver: true,
          bounciness: 12,
          speed: 16,
        }),
        Animated.timing(evidenceSheetOpacity, {
          toValue: 1,
          duration: 180,
          useNativeDriver: true,
        }),
      ]).start();
    });
  }, [evidenceSheetOpacity, evidenceSheetScale]);

  const closeEvidenceSheet = useCallback(() => {
    Animated.parallel([
      Animated.timing(evidenceSheetOpacity, {
        toValue: 0,
        duration: 140,
        useNativeDriver: true,
      }),
      Animated.timing(evidenceSheetScale, {
        toValue: 0.96,
        duration: 140,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setEvidenceSheet(null);
      evidenceSheetScale.setValue(0.92);
      evidenceSheetOpacity.setValue(0);
    });
  }, [evidenceSheetOpacity, evidenceSheetScale]);

  const lockPagerScroll = useCallback(() => {
    setPagerScrollEnabled(false);
  }, []);

  const unlockPagerScroll = useCallback(() => {
    setPagerScrollEnabled(true);
  }, []);

  const renderOverviewPage = useCallback(() => {
    if (!detail || !submission) {
      return null;
    }
    return (
      <ScrollView
        style={styles.pageScroll}
        contentContainerStyle={styles.pageContent}
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled
      >
        {job ? <DetectionPipelineCard job={job} result={result} title="检测链路" /> : null}

        {result ? (
          <PageSurface>
            <View style={styles.heroRow}>
              <View style={[styles.heroBadge, { backgroundColor: riskMeta.soft }]}>
                <MaterialCommunityIcons name={riskMeta.icon} size={18} color={riskMeta.tone} />
                <Text style={[styles.heroBadgeText, { color: riskMeta.tone }]}>{riskMeta.label}</Text>
              </View>
              {visibleFraudType ? <Text style={styles.heroType}>{visibleFraudType}</Text> : null}
            </View>
            <Text style={styles.heroTitle}>{headline}</Text>
            <Text style={styles.heroSummary}>{result.summary ?? "暂无结论"}</Text>

            <View style={styles.heroMetricRow}>
              <MetricChip label="评分" value={score ?? "--"} />
              <MetricChip label="可信度" value={formatConfidence(result.confidence)} />
            </View>

            {result.final_reason ? (
              <View style={styles.reasonBubble}>
                <Text style={styles.reasonBubbleText}>{result.final_reason}</Text>
              </View>
            ) : null}

            {result.advice?.length ? (
              <View style={styles.adviceBlock}>
                <SectionLabel>建议</SectionLabel>
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

            {guardianEventSummary ? (
              <View style={styles.guardianCard}>
                <View style={styles.guardianCardTop}>
                  <View style={styles.guardianCardCopy}>
                    <Text style={styles.guardianCardTitle}>已联动监护人</Text>
                    <Text style={styles.guardianCardMeta}>
                      {guardianEventSummary.latest_guardian_name ?? "监护人"} · {getGuardianNotifyStatusLabel(guardianEventSummary.latest_notify_status)}
                    </Text>
                  </View>
                  <Pressable
                    style={({ pressed }) => [styles.guardianCardButton, pressed && styles.buttonPressed]}
                    onPress={() =>
                      router.push({
                        pathname: "/guardians/events/[id]" as never,
                        params: { id: guardianEventSummary.latest_event_id } as never,
                      })
                    }
                  >
                    <Text style={styles.guardianCardButtonText}>查看</Text>
                  </Pressable>
                </View>
              </View>
            ) : result && (result.risk_level === "high" || result.risk_level === "medium") ? (
              <Pressable
                style={({ pressed }) => [
                  styles.guardianNotifyButton,
                  pressed && styles.buttonPressed,
                  notifyingGuardian && styles.buttonDisabled,
                ]}
                onPress={() => void handleNotifyGuardian()}
                disabled={notifyingGuardian}
              >
                <MaterialCommunityIcons name="account-group-outline" size={16} color={palette.accentStrong} />
                <Text style={styles.guardianNotifyButtonText}>
                  {notifyingGuardian ? "通知中..." : "通知监护人"}
                </Text>
              </Pressable>
            ) : null}

            <View style={styles.actionRow}>
              <InlinePill
                label={getJobStatusLabel(job?.status)}
                soft={riskMeta.soft}
                tone={riskMeta.tone}
                icon={riskMeta.icon}
              />
              {result.need_manual_review ? (
                <InlinePill label="建议复核" soft={palette.surfaceSoft} tone={palette.inkSoft} icon="account-search-outline" />
              ) : null}
            </View>

            <Pressable style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed]} onPress={handleRerun}>
              <MaterialCommunityIcons name="reload" size={16} color={palette.inkInverse} />
              <Text style={styles.primaryButtonText}>重新检测</Text>
            </Pressable>
          </PageSurface>
        ) : (
          <EmptyState
            title={job?.status === "pending" || job?.status === "running" ? "检测进行中" : "等待结果"}
            description={
              job?.status === "pending" || job?.status === "running"
                ? "总览会持续刷新当前进度，完成后自动展示结论。"
                : "任务完成后会在这里显示结论"
            }
          />
        )}
      </ScrollView>
    );
  }, [
    detail,
    guardianEventSummary,
    handleNotifyGuardian,
    handleRerun,
    headline,
    job,
    job?.status,
    notifyingGuardian,
    result,
    riskMeta.icon,
    riskMeta.soft,
    riskMeta.tone,
    router,
    score,
    submission,
    visibleFraudType,
  ]);

  const renderGraphPage = useCallback(() => {
    if (!result) {
      return (
        <ScrollView
          style={styles.pageScroll}
          contentContainerStyle={styles.pageContent}
          showsVerticalScrollIndicator={false}
          nestedScrollEnabled
        >
          {job ? <DetectionPipelineCard job={job} result={result} title="检测链路" /> : null}
          <EmptyState title="暂无图谱" description="结果生成后可左右切换查看" />
        </ScrollView>
      );
    }
    return (
      <ScrollView
        style={styles.pageScroll}
        contentContainerStyle={styles.pageContent}
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled
      >
        <ReasoningGraphCard result={result} showHeader={false} showPath={false} graphHeight={320} />
      </ScrollView>
    );
  }, [job, result]);

  const renderMaterialsPage = useCallback(() => {
    if (!detail || !submission) {
      return null;
    }
    const hasAttachments =
      submission.text_paths.length
      || submission.image_paths.length
      || submission.audio_paths.length
      || submission.video_paths.length;
    return (
      <ScrollView
        style={styles.pageScroll}
        contentContainerStyle={styles.pageContent}
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled
      >
        <PageSurface>
          <SectionLabel>原文</SectionLabel>
          <Text style={styles.rawText}>{submission.text_content?.trim() || "无文本"}</Text>
        </PageSurface>

        {result?.retrieved_evidence?.length ? (
          <EvidenceCarouselSection
            title="风险参照"
            items={result.retrieved_evidence}
            tone="black"
            cardWidth={evidenceCardWidth}
            onPressItem={openEvidenceSheet}
            onRailTouchStart={lockPagerScroll}
            onRailTouchEnd={unlockPagerScroll}
          />
        ) : null}
        {result?.counter_evidence?.length ? (
          <EvidenceCarouselSection
            title="安全参照"
            items={result.counter_evidence}
            tone="white"
            cardWidth={evidenceCardWidth}
            onPressItem={openEvidenceSheet}
            onRailTouchStart={lockPagerScroll}
            onRailTouchEnd={unlockPagerScroll}
          />
        ) : null}

        {hasAttachments ? (
          <PageSurface soft>
            <SectionLabel>附件</SectionLabel>
            <AttachmentChips items={submission.text_paths} />
            <AttachmentChips items={submission.image_paths} />
            <AttachmentChips items={submission.audio_paths} />
            <AttachmentChips items={submission.video_paths} />
          </PageSurface>
        ) : null}
      </ScrollView>
    );
  }, [detail, evidenceCardWidth, lockPagerScroll, openEvidenceSheet, result, submission, unlockPagerScroll]);

  const renderPage = useCallback(({ item }: { item: (typeof DETAIL_PAGES)[number] }) => {
    let content: ReactNode = null;
    if (item.key === "overview") {
      content = renderOverviewPage();
    } else if (item.key === "graph") {
      content = renderGraphPage();
    } else {
      content = renderMaterialsPage();
    }
    return <View style={[styles.pageFrame, { width }]}>{content}</View>;
  }, [renderGraphPage, renderMaterialsPage, renderOverviewPage, width]);

  return (
    <View style={styles.root}>
      <View style={styles.backgroundOrbTop} />
      <View style={styles.backgroundOrbBottom} />
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <View style={styles.header}>
          <View style={styles.headerTopRow}>
            <Pressable style={({ pressed }) => [styles.backButton, pressed && styles.buttonPressed]} onPress={() => router.back()}>
              <MaterialCommunityIcons name="chevron-left" size={18} color={palette.accentStrong} />
            </Pressable>
            <View style={styles.headerTitleWrap}>
              <Text style={styles.pageTitle}>检测详情</Text>
              <Text style={styles.pageTime}>{formatDateTime(submission?.created_at ?? job?.created_at)}</Text>
            </View>
          </View>

          {!loading && !error && detail && submission ? (
            <View style={styles.tabRow}>
              {DETAIL_PAGES.map((item, index) => {
                const active = index === pageIndex;
                return (
                  <Pressable
                    key={item.key}
                    style={({ pressed }) => [
                      styles.tabButton,
                      active && styles.tabButtonActive,
                      pressed && styles.buttonPressed,
                    ]}
                    onPress={() => onPressPage(index)}
                  >
                    <Text style={[styles.tabButtonText, active && styles.tabButtonTextActive]}>{item.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </View>

        {loading ? (
          <View style={styles.stateWrap}>
            <ActivityIndicator size="small" color={palette.accentStrong} />
            <Text style={styles.stateText}>加载中</Text>
          </View>
        ) : error ? (
          <View style={styles.stateCard}>
            <Text style={styles.stateTitle}>加载失败</Text>
            <Text style={styles.stateText}>{error}</Text>
          </View>
        ) : !detail || !submission ? (
          <View style={styles.stateCard}>
            <Text style={styles.stateTitle}>无记录</Text>
            <Text style={styles.stateText}>未找到对应检测记录</Text>
          </View>
        ) : (
          <>
            <FlatList
              ref={pagerRef}
              data={DETAIL_PAGES}
              horizontal
              pagingEnabled
              scrollEnabled={pagerScrollEnabled}
              bounces={false}
              showsHorizontalScrollIndicator={false}
              keyExtractor={(item) => item.key}
              renderItem={renderPage}
              onMomentumScrollEnd={onMomentumScrollEnd}
              getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
              style={styles.pager}
            />
          </>
        )}
      </SafeAreaView>

      <Modal
        visible={Boolean(evidenceSheet)}
        transparent
        animationType="none"
        onRequestClose={closeEvidenceSheet}
      >
        <View style={styles.sheetOverlay}>
          <Pressable style={styles.sheetBackdrop} onPress={closeEvidenceSheet} />
          {evidenceSheet ? (
            <Animated.View
              style={[
                styles.sheetCard,
                {
                  opacity: evidenceSheetOpacity,
                  transform: [{ scale: evidenceSheetScale }],
                },
              ]}
            >
              <View style={styles.sheetHeader}>
                <View style={styles.sheetTitleBlock}>
                  <Text style={styles.sheetTitle}>{evidenceSheet.title}</Text>
                  <View style={styles.sheetMetaRow}>
                    {evidenceSheet.item.fraud_type ? (
                      <View style={styles.evidenceTypeChip}>
                        <Text style={styles.evidenceTypeChipText} numberOfLines={1}>
                          {evidenceSheet.item.fraud_type}
                        </Text>
                      </View>
                    ) : null}
                    <Text style={styles.sheetScore}>{getSimilarityPercent(evidenceSheet.item.similarity_score)}</Text>
                  </View>
                </View>

                <Pressable style={({ pressed }) => [styles.sheetCloseButton, pressed && styles.buttonPressed]} onPress={closeEvidenceSheet}>
                  <MaterialCommunityIcons name="close" size={18} color={palette.accentStrong} />
                </Pressable>
              </View>

              <ScrollView
                style={styles.sheetBody}
                contentContainerStyle={styles.sheetBodyContent}
                showsVerticalScrollIndicator={false}
              >
                {evidenceSheetImageUrl ? (
                  <Image
                    source={{ uri: evidenceSheetImageUrl }}
                    style={styles.sheetPreviewImage}
                    contentFit="cover"
                    transition={120}
                  />
                ) : null}
                <Text style={styles.sheetBodyText}>{evidenceSheet.item.chunk_text}</Text>
                {!evidenceSheetImageUrl && evidenceSheet.item.reason ? (
                  <Text style={styles.sheetReasonText}>{evidenceSheet.item.reason}</Text>
                ) : null}
              </ScrollView>
            </Animated.View>
          ) : null}
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
  backgroundOrbTop: {
    position: "absolute",
    top: -96,
    left: -46,
    width: 230,
    height: 230,
    borderRadius: 999,
    backgroundColor: "rgba(117, 167, 255, 0.14)",
  },
  backgroundOrbBottom: {
    position: "absolute",
    right: -88,
    bottom: 110,
    width: 250,
    height: 250,
    borderRadius: 999,
    backgroundColor: "rgba(196, 218, 255, 0.18)",
  },
  backButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "rgba(255,255,255,0.74)",
    borderWidth: 1,
    borderColor: palette.line,
    justifyContent: "center",
    alignItems: "center",
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 4,
    gap: 8,
  },
  headerTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  headerTitleWrap: {
    flex: 1,
    gap: 1,
  },
  pageTitle: {
    color: palette.ink,
    fontSize: 20,
    lineHeight: 24,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  pageTime: {
    color: palette.inkSoft,
    fontSize: 10,
    lineHeight: 12,
    fontFamily: fontFamily.body,
  },
  headerMetaLine: {
    flexDirection: "row",
    alignItems: "center",
  },
  headerMetaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  inlinePill: {
    minHeight: 32,
    borderRadius: radius.pill,
    backgroundColor: palette.surface,
    paddingHorizontal: 12,
    paddingVertical: 7,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  inlinePillText: {
    color: palette.accentStrong,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  tabRow: {
    flexDirection: "row",
    gap: 6,
  },
  tabButton: {
    flex: 1,
    minHeight: 32,
    borderRadius: radius.pill,
    backgroundColor: "rgba(255,255,255,0.58)",
    borderWidth: 1,
    borderColor: palette.line,
    alignItems: "center",
    justifyContent: "center",
  },
  tabButtonActive: {
    backgroundColor: palette.accentStrong,
    borderColor: palette.accentStrong,
  },
  tabButtonText: {
    color: palette.accentStrong,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  tabButtonTextActive: {
    color: palette.inkInverse,
  },
  dotRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    paddingTop: 12,
    paddingBottom: 8,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 999,
    backgroundColor: "rgba(47,112,230,0.22)",
  },
  dotActive: {
    width: 22,
    backgroundColor: palette.accentStrong,
  },
  pager: {
    flex: 1,
  },
  pageFrame: {
    flex: 1,
  },
  pageScroll: {
    flex: 1,
  },
  pageContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 32,
    gap: 16,
  },
  pageSurface: {
    borderRadius: radius.xl,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 14,
    ...panelShadow,
  },
  pageSurfaceSoft: {
    backgroundColor: "rgba(255,255,255,0.78)",
  },
  heroRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  heroBadge: {
    alignSelf: "flex-start",
    minHeight: 36,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  heroBadgeText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  heroType: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    fontFamily: fontFamily.body,
    textAlign: "right",
  },
  heroTitle: {
    color: palette.ink,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  heroSummary: {
    color: palette.ink,
    fontSize: 15,
    lineHeight: 22,
    fontFamily: fontFamily.body,
  },
  heroMetricRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  metricChip: {
    minWidth: "47%",
    borderRadius: radius.md,
    backgroundColor: palette.surfaceSoft,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 4,
  },
  metricChipLabel: {
    color: palette.inkSoft,
    fontSize: 11,
    lineHeight: 14,
    fontFamily: fontFamily.body,
  },
  metricChipValue: {
    color: palette.ink,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  reasonBubble: {
    borderRadius: radius.lg,
    backgroundColor: palette.surfaceSoft,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  reasonBubbleText: {
    color: palette.ink,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: fontFamily.body,
  },
  adviceBlock: {
    gap: 10,
  },
  guardianCard: {
    borderRadius: radius.lg,
    backgroundColor: "#EAF8F1",
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 10,
  },
  guardianCardTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  guardianCardCopy: {
    flex: 1,
    gap: 4,
  },
  guardianCardTitle: {
    color: "#1A8B5B",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  guardianCardMeta: {
    color: "#2F6E52",
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fontFamily.body,
  },
  guardianCardButton: {
    borderRadius: radius.pill,
    backgroundColor: palette.surface,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  guardianCardButtonText: {
    color: palette.ink,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  guardianNotifyButton: {
    minHeight: 44,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.accentStrong,
    backgroundColor: palette.accentSoft,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  guardianNotifyButtonText: {
    color: palette.accentStrong,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  primaryButton: {
    minHeight: 44,
    borderRadius: radius.pill,
    backgroundColor: palette.accentStrong,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  primaryButtonText: {
    color: palette.inkInverse,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  sectionLabel: {
    color: palette.inkSoft,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  rawText: {
    color: palette.ink,
    fontSize: 14,
    lineHeight: 22,
    fontFamily: fontFamily.body,
  },
  evidenceRail: {
    gap: 12,
    paddingRight: 2,
  },
  evidenceCard: {
    borderRadius: radius.lg,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 10,
  },
  evidenceCardPressed: {
    transform: [{ scale: 0.97 }],
  },
  evidenceCardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 10,
  },
  evidenceTagRow: {
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  evidenceBadge: {
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  evidenceBadgeText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  evidenceTypeChip: {
    maxWidth: "100%",
    borderRadius: radius.pill,
    backgroundColor: palette.surfaceSoft,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  evidenceTypeChipText: {
    color: palette.accentStrong,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  evidenceScore: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  evidencePreviewText: {
    color: palette.ink,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: fontFamily.body,
  },
  evidencePreviewImage: {
    width: "100%",
    aspectRatio: 1.05,
    borderRadius: radius.md,
    backgroundColor: palette.backgroundDeep,
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
  stateWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: 24,
  },
  stateCard: {
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: radius.xl,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 18,
    paddingVertical: 18,
    gap: 8,
    ...panelShadow,
  },
  stateTitle: {
    color: palette.ink,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  stateText: {
    color: palette.inkSoft,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  emptyCard: {
    borderRadius: radius.xl,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 18,
    paddingVertical: 18,
    gap: 8,
    ...panelShadow,
  },
  emptyTitle: {
    color: palette.ink,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  emptyText: {
    color: palette.inkSoft,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  sheetOverlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingVertical: 24,
  },
  sheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(11, 18, 33, 0.28)",
  },
  sheetCard: {
    width: "100%",
    maxWidth: 420,
    maxHeight: "68%",
    borderRadius: 24,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 18,
    gap: 14,
    ...panelShadow,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  sheetTitleBlock: {
    flex: 1,
    gap: 8,
  },
  sheetTitle: {
    color: palette.ink,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  sheetMetaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
  },
  sheetScore: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  sheetCloseButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: palette.surfaceSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetBody: {
    maxHeight: 360,
  },
  sheetBodyContent: {
    gap: 12,
  },
  sheetPreviewImage: {
    width: "100%",
    aspectRatio: 1.08,
    borderRadius: radius.lg,
    backgroundColor: palette.backgroundDeep,
  },
  sheetBodyText: {
    color: palette.ink,
    fontSize: 14,
    lineHeight: 22,
    fontFamily: fontFamily.body,
  },
  sheetReasonText: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  buttonPressed: {
    transform: [{ scale: 0.98 }],
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});
