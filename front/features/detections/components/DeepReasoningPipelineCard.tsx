import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";

import { formatRiskScore, getResultRiskScore } from "../displayText";
import type { DetectionJob, DetectionResult, KnownDetectionPipelineStep } from "../types";
import { getProgressDetail, normalizeDetectionStep, pipelineDisplaySteps } from "../visualization";

const deepStepMeta: Record<
  KnownDetectionPipelineStep,
  {
    label: string;
    shortLabel: string;
    icon: keyof typeof MaterialCommunityIcons.glyphMap;
    accent: string;
    soft: string;
  }
> = {
  queued: {
    label: "等待处理",
    shortLabel: "等待",
    icon: "timer-sand",
    accent: "#2F70E6",
    soft: "#EEF5FF",
  },
  preprocess: {
    label: "文本归整",
    shortLabel: "归整",
    icon: "file-document-outline",
    accent: "#2F70E6",
    soft: "#EEF5FF",
  },
  embedding: {
    label: "线索抽取",
    shortLabel: "抽取",
    icon: "text-recognition",
    accent: "#5B7CF5",
    soft: "#EEF0FF",
  },
  vector_retrieval: {
    label: "黑白对照",
    shortLabel: "对照",
    icon: "compare-horizontal",
    accent: "#D47C3A",
    soft: "#FFF5EC",
  },
  graph_reasoning: {
    label: "阶段建链",
    shortLabel: "建链",
    icon: "timeline-outline",
    accent: "#CC8A2D",
    soft: "#FFF8E9",
  },
  llm_reasoning: {
    label: "反证约束",
    shortLabel: "约束",
    icon: "shield-star-outline",
    accent: "#2E9D7F",
    soft: "#EAF9F4",
  },
  finalize: {
    label: "收束判定",
    shortLabel: "判定",
    icon: "shield-check-outline",
    accent: "#244C86",
    soft: "#EEF5FF",
  },
};

function clampProgress(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function getStatusLabel(status?: string | null) {
  if (status === "completed") {
    return "完成";
  }
  if (status === "failed") {
    return "失败";
  }
  if (status === "running") {
    return "运行中";
  }
  return "排队";
}

function getActiveArea(step: KnownDetectionPipelineStep) {
  if (step === "vector_retrieval") {
    return 1;
  }
  if (step === "graph_reasoning" || step === "llm_reasoning") {
    return 2;
  }
  if (step === "finalize") {
    return 3;
  }
  return 0;
}

export function DeepReasoningPipelineCard({
  job,
  result,
  title = "深度链路",
}: {
  job?: DetectionJob | null;
  result?: DetectionResult | null;
  title?: string;
}) {
  const progressDetail = getProgressDetail(job);
  const isRunning = job?.status === "pending" || job?.status === "running";
  const liveStep = normalizeDetectionStep(job?.current_step ?? undefined, job?.status ?? undefined);
  const [fallbackIndex, setFallbackIndex] = useState(0);

  useEffect(() => {
    if (!isRunning || job?.current_step) {
      return;
    }
    const timer = setInterval(() => {
      setFallbackIndex((prev) => (prev + 1) % pipelineDisplaySteps.length);
    }, 1200);
    return () => clearInterval(timer);
  }, [isRunning, job?.current_step]);

  const activeStep = useMemo<KnownDetectionPipelineStep>(() => {
    if (job?.status === "completed" || result) {
      return "finalize";
    }
    if (job?.status === "failed") {
      return liveStep;
    }
    if (isRunning && !job?.current_step) {
      return pipelineDisplaySteps[fallbackIndex] ?? "preprocess";
    }
    return liveStep;
  }, [fallbackIndex, isRunning, job?.current_step, job?.status, liveStep, result]);

  const progress = useMemo(() => {
    if (typeof job?.progress_percent === "number") {
      return clampProgress(job.progress_percent);
    }
    if (result) {
      return 100;
    }
    if (isRunning) {
      return 18 + fallbackIndex * 14;
    }
    return 0;
  }, [fallbackIndex, isRunning, job?.progress_percent, result]);

  const meta = deepStepMeta[activeStep];
  const blackHits = typeof progressDetail?.black_hits === "number" ? progressDetail.black_hits : result?.retrieved_evidence.length ?? 0;
  const whiteHits = typeof progressDetail?.white_hits === "number" ? progressDetail.white_hits : result?.counter_evidence.length ?? 0;
  const signalCount = typeof progressDetail?.signal_count === "number" ? progressDetail.signal_count : 0;
  const metrics = [
    { label: "进度", value: `${progress}%` },
    { label: "线索", value: String(signalCount) },
    { label: "风险", value: String(blackHits) },
    { label: "安全", value: String(whiteHits) },
  ];
  const riskScore = getResultRiskScore(result);
  if (riskScore !== null) {
    metrics[1] = { label: "评分", value: formatRiskScore(riskScore) };
  }

  const sceneArea = getActiveArea(activeStep);

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>{title}</Text>
        <View style={[styles.statusPill, { backgroundColor: meta.soft }]}>
          <Text style={[styles.statusPillText, { color: meta.accent }]}>{getStatusLabel(job?.status)}</Text>
        </View>
      </View>

      <View style={styles.activeRow}>
        <View style={[styles.activeIconWrap, { backgroundColor: meta.soft }]}>
          <MaterialCommunityIcons name={meta.icon} size={18} color={meta.accent} />
        </View>
        <Text style={styles.activeLabel}>{meta.label}</Text>
      </View>

      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${progress}%`, backgroundColor: meta.accent }]} />
      </View>

      <View style={styles.board}>
        <View style={styles.boardLine} />

        <View style={[styles.boardCell, sceneArea === 0 && styles.boardCellActive]}>
          <View style={[styles.boardIcon, { backgroundColor: sceneArea === 0 ? "#EEF5FF" : "#F7FAFF" }]}>
            <MaterialCommunityIcons name="file-document-outline" size={16} color="#2F70E6" />
          </View>
          <Text style={styles.boardLabel}>原文</Text>
        </View>

        <View style={[styles.boardCell, sceneArea === 1 && styles.boardCellActive]}>
          <View style={styles.compareStack}>
            <View style={[styles.compareChip, styles.compareChipRisk]}>
              <Text style={[styles.compareChipText, styles.compareChipTextRisk]}>风险 {blackHits}</Text>
            </View>
            <View style={[styles.compareChip, styles.compareChipSafe]}>
              <Text style={[styles.compareChipText, styles.compareChipTextSafe]}>安全 {whiteHits}</Text>
            </View>
          </View>
          <Text style={styles.boardLabel}>对照</Text>
        </View>

        <View style={[styles.boardCell, sceneArea === 2 && styles.boardCellActive]}>
          <View style={styles.stageStack}>
            <View style={styles.stageMiniLine} />
            <View style={[styles.stageMiniDot, styles.stageMiniDotPrimary]} />
            <View style={[styles.stageMiniDot, styles.stageMiniDotWarning]} />
            <View style={[styles.stageMiniDot, styles.stageMiniDotDanger]} />
          </View>
          <Text style={styles.boardLabel}>阶段</Text>
        </View>

        <View style={[styles.boardCell, sceneArea === 3 && styles.boardCellActive]}>
          <View style={[styles.boardIcon, { backgroundColor: sceneArea === 3 ? "#EEF5FF" : "#F7FAFF" }]}>
            <MaterialCommunityIcons name="shield-check-outline" size={16} color="#244C86" />
          </View>
          <Text style={styles.boardLabel}>判定</Text>
        </View>
      </View>

      <View style={styles.traceRow}>
        {(pipelineDisplaySteps as KnownDetectionPipelineStep[]).map((step, index) => {
          const stepMeta = deepStepMeta[step];
          const currentIndex = pipelineDisplaySteps.indexOf(activeStep);
          const done = result || index < currentIndex;
          const current = index === currentIndex && !result;
          return (
            <View key={step} style={styles.traceCell}>
              <View style={styles.traceTop}>
                <View
                  style={[
                    styles.traceDot,
                    { backgroundColor: done || current ? stepMeta.accent : "#D6E4FA" },
                  ]}
                />
                {index < pipelineDisplaySteps.length - 1 ? (
                  <View
                    style={[
                      styles.traceLine,
                      { backgroundColor: done ? stepMeta.accent : "#D6E4FA" },
                    ]}
                  />
                ) : null}
              </View>
              <Text style={[styles.traceLabel, current && { color: stepMeta.accent }]}>{stepMeta.shortLabel}</Text>
            </View>
          );
        })}
      </View>

      <View style={styles.metricRow}>
        {metrics.map((item) => (
          <View key={`${item.label}-${item.value}`} style={styles.metricChip}>
            <Text style={styles.metricLabel}>{item.label}</Text>
            <Text style={styles.metricValue}>{item.value}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.xl,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 14,
    ...panelShadow,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  title: {
    color: palette.ink,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  statusPill: {
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  statusPillText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  activeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  activeIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  activeLabel: {
    color: palette.ink,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  progressTrack: {
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: "#E6EEF9",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: radius.pill,
  },
  board: {
    position: "relative",
    borderRadius: radius.lg,
    backgroundColor: "#F7FAFF",
    borderWidth: 1,
    borderColor: "#DEE8F8",
    paddingHorizontal: 12,
    paddingVertical: 16,
    flexDirection: "row",
    gap: 8,
  },
  boardLine: {
    position: "absolute",
    left: 28,
    right: 28,
    top: 45,
    height: 2,
    borderRadius: radius.pill,
    backgroundColor: "#DBE7F7",
  },
  boardCell: {
    flex: 1,
    minHeight: 84,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  boardCellActive: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#D7E5FB",
  },
  boardIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#D9E6F9",
  },
  boardLabel: {
    color: palette.inkSoft,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  compareStack: {
    gap: 6,
    alignItems: "center",
  },
  compareChip: {
    minWidth: 54,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 5,
    alignItems: "center",
    justifyContent: "center",
  },
  compareChipRisk: {
    backgroundColor: "#FFF1EA",
  },
  compareChipSafe: {
    backgroundColor: "#EAF9F4",
  },
  compareChipText: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  compareChipTextRisk: {
    color: "#D96A4A",
  },
  compareChipTextSafe: {
    color: "#2E9D7F",
  },
  stageStack: {
    width: 28,
    height: 42,
    alignItems: "center",
    justifyContent: "space-between",
    position: "relative",
  },
  stageMiniLine: {
    position: "absolute",
    top: 4,
    bottom: 4,
    width: 2,
    borderRadius: radius.pill,
    backgroundColor: "#DCE7F7",
  },
  stageMiniDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  stageMiniDotPrimary: {
    backgroundColor: "#2F70E6",
  },
  stageMiniDotWarning: {
    backgroundColor: "#E3A04B",
  },
  stageMiniDotDanger: {
    backgroundColor: "#D96A4A",
  },
  traceRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  traceCell: {
    flex: 1,
    alignItems: "flex-start",
    gap: 6,
  },
  traceTop: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
  },
  traceDot: {
    width: 14,
    height: 14,
    borderRadius: 999,
  },
  traceLine: {
    flex: 1,
    height: 2,
    marginLeft: 6,
    borderRadius: 999,
  },
  traceLabel: {
    color: palette.inkSoft,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  metricRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  metricChip: {
    borderRadius: radius.pill,
    backgroundColor: palette.surfaceSoft,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  metricLabel: {
    color: palette.inkSoft,
    fontSize: 11,
    lineHeight: 14,
    fontFamily: fontFamily.body,
  },
  metricValue: {
    color: palette.ink,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
});
