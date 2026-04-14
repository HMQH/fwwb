import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { FadeInDown, FadeOutUp } from "react-native-reanimated";

import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";
import { useReduceMotionEnabled } from "@/shared/useReduceMotionEnabled";

import type { DetectionJob, DetectionResult, KnownDetectionPipelineStep } from "../types";
import {
  buildDetectionModuleTrace,
  getProgressDetail,
  getResultDetail,
  normalizeDetectionStep,
  pipelineDisplaySteps,
  pipelineStepMeta,
} from "../visualization";
import { ProcessScene } from "./ProcessScene";

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

export function DetectionPipelineCard({
  job,
  result,
  title = "检测链路",
  showHeader = true,
}: {
  job?: DetectionJob | null;
  result?: DetectionResult | null;
  title?: string;
  showHeader?: boolean;
}) {
  const reduceMotion = useReduceMotionEnabled();
  const progressDetail = getProgressDetail(job);
  const resultDetail = getResultDetail(result);
  const moduleTrace = useMemo(() => buildDetectionModuleTrace(job, result), [job, result]);
  const liveStep = normalizeDetectionStep(job?.current_step ?? undefined, job?.status ?? undefined);
  const isRunning = job?.status === "pending" || job?.status === "running";
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

  const meta = pipelineStepMeta[activeStep];
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

  const metrics = useMemo(() => {
    const graphMetrics =
      resultDetail?.reasoning_graph?.summary_metrics ?? progressDetail?.reasoning_graph?.summary_metrics;
    const finalScore = resultDetail?.final_score ?? progressDetail?.final_score;
    const signalCount =
      typeof graphMetrics?.signal_count === "number" ? graphMetrics.signal_count : undefined;
    const riskBasisCount =
      typeof graphMetrics?.risk_basis_count === "number" ? graphMetrics.risk_basis_count : signalCount;
    const counterBasisCount =
      typeof graphMetrics?.counter_basis_count === "number" ? graphMetrics.counter_basis_count : undefined;
    const blackCount =
      typeof graphMetrics?.black_count === "number"
        ? graphMetrics.black_count
        : result?.retrieved_evidence.length;
    const whiteCount =
      typeof graphMetrics?.white_count === "number"
        ? graphMetrics.white_count
        : result?.counter_evidence.length;

    return [
      { label: "进度", value: `${progress}%` },
      ...(typeof finalScore === "number" ? [{ label: "评分", value: String(Math.round(finalScore)) }] : []),
      ...(typeof riskBasisCount === "number" ? [{ label: "可疑", value: String(riskBasisCount) }] : []),
      ...(typeof counterBasisCount === "number" ? [{ label: "降险", value: String(counterBasisCount) }] : []),
      ...(typeof blackCount === "number" && typeof counterBasisCount !== "number"
        ? [{ label: "风险参照", value: String(blackCount) }]
        : []),
      ...(typeof whiteCount === "number" && typeof counterBasisCount !== "number"
        ? [{ label: "安全参照", value: String(whiteCount) }]
        : []),
    ].slice(0, 4);
  }, [
    progress,
    progressDetail?.final_score,
    progressDetail?.reasoning_graph?.summary_metrics,
    result,
    resultDetail?.final_score,
    resultDetail?.reasoning_graph?.summary_metrics,
  ]);

  return (
    <View style={styles.card}>
      {showHeader ? (
        <View style={styles.headerRow}>
          <Text style={styles.title}>{title}</Text>
          <View style={[styles.statusPill, { backgroundColor: meta.soft }]}>
            <Text style={[styles.statusPillText, { color: meta.accent }]}>{getStatusLabel(job?.status)}</Text>
          </View>
        </View>
      ) : null}

      <View style={styles.activeRow}>
        <View style={[styles.activeIconWrap, { backgroundColor: meta.soft }]}>
          <MaterialCommunityIcons name={meta.icon as never} size={18} color={meta.accent} />
        </View>
        <View style={styles.activeCopy}>
          <View style={styles.activeSlot}>
            <Animated.View
              key={activeStep}
              entering={reduceMotion ? undefined : FadeInDown.duration(220)}
              exiting={reduceMotion ? undefined : FadeOutUp.duration(180)}
            >
              <Text style={styles.activeLabel}>{meta.label}</Text>
            </Animated.View>
          </View>
        </View>
      </View>

      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${progress}%`, backgroundColor: meta.accent }]} />
      </View>

      <ProcessScene step={activeStep} />

      <View style={styles.traceRow}>
        {moduleTrace.map((item, index) => {
          const stepKey = normalizeDetectionStep(item.key, item.status);
          const stepMeta = pipelineStepMeta[stepKey];
          const isCurrent =
            item.status === "running" || (item.status === "completed" && activeStep === stepKey && progress === 100);
          const isDone = item.status === "completed";
          const isFailed = item.status === "failed";
          return (
            <View key={item.key} style={styles.traceCell}>
              <View style={styles.traceTop}>
                <View
                  style={[
                    styles.traceDot,
                    {
                      backgroundColor: isFailed
                        ? "#D96A4A"
                        : isCurrent || isDone
                          ? stepMeta.accent
                          : "#D6E4FA",
                    },
                  ]}
                />
                {index < moduleTrace.length - 1 ? (
                  <View style={[styles.traceLine, { backgroundColor: isDone ? stepMeta.accent : "#D6E4FA" }]} />
                ) : null}
              </View>
              <Text style={[styles.traceLabel, isCurrent && { color: stepMeta.accent }]}>{item.label}</Text>
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
  activeCopy: {
    flex: 1,
    minHeight: 28,
    justifyContent: "center",
  },
  activeSlot: {
    minHeight: 28,
    justifyContent: "center",
    overflow: "hidden",
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
    backgroundColor: palette.backgroundDeep,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: radius.pill,
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
