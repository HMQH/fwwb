import { MaterialCommunityIcons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";

import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";

import type { DetectionJob, DetectionKagPayload } from "../types";
import { normalizeDetectionStep } from "../visualization";
import { DeepReasoningStageGraph } from "./DeepReasoningStageGraph";

const stageBlueprint = [
  { code: "hook", label: "接触建链", tone: "primary" },
  { code: "instruction", label: "诱导操作", tone: "warning" },
  { code: "pressure", label: "施压锁定", tone: "warning" },
  { code: "payment", label: "资金收口", tone: "danger" },
  { code: "cover_up", label: "隔离断联", tone: "danger" },
] as const;

function buildPendingPayload(job?: DetectionJob | null): DetectionKagPayload {
  const step = normalizeDetectionStep(job?.current_step ?? undefined, job?.status ?? undefined);
  const progress = Math.max(0, Math.min(100, Number(job?.progress_percent ?? 0)));

  const activeIndexMap = {
    preprocess: 0,
    embedding: 0,
    vector_retrieval: 1,
    graph_reasoning: 2,
    llm_reasoning: 3,
    finalize: 4,
    queued: 0,
  } as const;

  const activeIndex = activeIndexMap[step] ?? 0;
  const supportSeeds = [
    [18, 0, 0, 0, 0],
    [42, 16, 0, 0, 0],
    [58, 48, 22, 0, 0],
    [68, 64, 56, 32, 0],
    [74, 70, 66, 58, 38],
  ][Math.min(activeIndex, 4)] ?? [0, 0, 0, 0, 0];

  const nextStepMap = {
    preprocess: "线索抽取",
    embedding: "黑白对照",
    vector_retrieval: "阶段建链",
    graph_reasoning: "反证约束",
    llm_reasoning: "收束判定",
    finalize: "输出结论",
    queued: "文本归整",
  } as const;

  return {
    enabled: true,
    mode: "deep",
    current_stage: {
      code: stageBlueprint[activeIndex]?.code ?? "hook",
      label: stageBlueprint[activeIndex]?.label ?? "接触建链",
      score: progress / 100,
      tone: stageBlueprint[activeIndex]?.tone ?? "primary",
    },
    predicted_next_step: nextStepMap[step] ?? "继续推理",
    trajectory: stageBlueprint.slice(0, activeIndex + 1).map((item) => item.label),
    stage_rows: stageBlueprint.map((item, index) => ({
      code: item.code,
      label: item.label,
      score: (supportSeeds[index] ?? 0) / 100,
      support_score: (supportSeeds[index] ?? 0) / 100,
      active: index <= activeIndex,
      tone: item.tone,
      black_count: index <= activeIndex ? Math.max(0, activeIndex + index - 1) : 0,
      white_count: index < activeIndex ? 1 : 0,
    })),
    reasoning_path: stageBlueprint.slice(0, activeIndex + 1).map((item) => item.label),
  };
}

function getStepLabel(job?: DetectionJob | null) {
  const step = normalizeDetectionStep(job?.current_step ?? undefined, job?.status ?? undefined);
  return {
    preprocess: "文本归整",
    embedding: "线索抽取",
    vector_retrieval: "黑白对照",
    graph_reasoning: "阶段建链",
    llm_reasoning: "反证约束",
    finalize: "收束判定",
    queued: "等待处理",
  }[step] ?? "深度推理";
}

export function DeepReasoningPendingGraphCard({
  job,
  title = "阶段链路",
}: {
  job?: DetectionJob | null;
  title?: string;
}) {
  const kag = buildPendingPayload(job);

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>{title}</Text>
        <View style={styles.pill}>
          <MaterialCommunityIcons name="timeline-outline" size={13} color="#2F70E6" />
          <Text style={styles.pillText}>{getStepLabel(job)}</Text>
        </View>
      </View>

      <DeepReasoningStageGraph kag={kag} height={320} />
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
  pill: {
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: "#F7FBFF",
    borderWidth: 1,
    borderColor: "#D7E6FC",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  pillText: {
    color: "#2F70E6",
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
});
