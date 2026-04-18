import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { SimilarImageGalleryCard } from "@/features/detections/components/SimilarImageGalleryCard";
import { fontFamily, palette, radius } from "@/shared/theme";
import { useReduceMotionEnabled } from "@/shared/useReduceMotionEnabled";

import type { AssistantClarifyOption, AssistantExecution, AssistantExecutionStep } from "../types";

function planTone(status: string) {
  if (status === "failed") {
    return { bg: "#FDEDED", text: "#C05858" };
  }
  if (status === "completed") {
    return { bg: "#EDF7F1", text: "#377A56" };
  }
  if (status === "running") {
    return { bg: "#EAF2FF", text: palette.accentStrong };
  }
  return { bg: "#F3F6FA", text: "#607086" };
}

function RunningGlow() {
  const reduceMotion = useReduceMotionEnabled();
  const translateX = useSharedValue(-180);

  useEffect(() => {
    if (reduceMotion) {
      return;
    }
    translateX.value = withRepeat(
      withTiming(220, {
        duration: 1200,
        easing: Easing.out(Easing.quad),
      }),
      -1,
      false
    );
    return () => {
      cancelAnimation(translateX);
    };
  }, [reduceMotion, translateX]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
    opacity: reduceMotion ? 0.35 : 0.9,
  }));

  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFillObject, styles.glowWrap, animatedStyle]}>
      <LinearGradient
        colors={["rgba(47,112,230,0)", "rgba(47,112,230,0.18)", "rgba(47,112,230,0)"]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={styles.glowGradient}
      />
    </Animated.View>
  );
}

function ClarifyActions({
  options,
  disabled,
  onPressOption,
}: {
  options: AssistantClarifyOption[];
  disabled?: boolean;
  onPressOption?: (option: AssistantClarifyOption) => void;
}) {
  if (!options.length) {
    return null;
  }

  return (
    <View style={styles.actionWrap}>
      {options.map((option) => (
        <Pressable
          key={option.key}
          style={({ pressed }) => [
            styles.actionChip,
            pressed && styles.pressed,
            disabled && styles.actionChipDisabled,
          ]}
          disabled={disabled}
          onPress={() => onPressOption?.(option)}
        >
          <Text style={styles.actionChipText}>{option.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function buildInlineText(step: AssistantExecutionStep) {
  if (step.summary && step.summary !== step.title) {
    return `${step.title} · ${step.summary}`;
  }
  if (step.status === "running") {
    return `${step.title} · 执行中`;
  }
  if (step.status === "failed") {
    return `${step.title} · 失败`;
  }
  return step.title;
}

function StepCard({
  step,
  expanded,
  onToggle,
}: {
  step: AssistantExecutionStep;
  expanded: boolean;
  onToggle: () => void;
}) {
  const hasDetail = Boolean((step.details && step.details.length) || (step.gallery_items && step.gallery_items.length));

  return (
    <View style={styles.stepWrap}>
      <Pressable
        style={({ pressed }) => [
          styles.stepRow,
          step.status === "running" && styles.stepRunning,
          step.status === "failed" && styles.stepFailed,
          pressed && styles.pressed,
        ]}
        disabled={!hasDetail}
        onPress={onToggle}
      >
        {step.status === "running" ? <RunningGlow /> : null}
        <View style={styles.stepIndicatorWrap}>
          <View
            style={[
              styles.stepIndicator,
              step.status === "running" && styles.stepIndicatorRunning,
              step.status === "failed" && styles.stepIndicatorFailed,
              step.status === "completed" && styles.stepIndicatorCompleted,
            ]}
          />
        </View>
        <Text style={styles.stepInlineText} numberOfLines={1}>
          {buildInlineText(step)}
        </Text>
        {hasDetail ? (
          <MaterialCommunityIcons
            name={expanded ? "chevron-up" : "chevron-down"}
            size={16}
            color="#7B8798"
          />
        ) : null}
      </Pressable>

      {expanded && hasDetail ? (
        <View style={styles.stepDetailCard}>
          <ScrollView nestedScrollEnabled style={styles.stepDetailScroll} contentContainerStyle={styles.stepDetailContent}>
            {step.details?.map((line) => (
              <Text key={`${step.id}-${line}`} style={styles.detailLine}>
                {line}
              </Text>
            ))}
            {step.gallery_items?.length ? (
              <SimilarImageGalleryCard items={step.gallery_items} title="候选图片" />
            ) : null}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

export function AssistantExecutionBlock({
  execution,
  disabled,
  onPressQuickAction,
}: {
  execution: AssistantExecution | null;
  disabled?: boolean;
  onPressQuickAction?: (option: AssistantClarifyOption) => void;
}) {
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const steps = execution?.steps ?? [];

  useEffect(() => {
    setExpandedIds({});
  }, [execution?.mode, steps.length]);

  if (!execution) {
    return null;
  }

  return (
    <View style={styles.card}>
      {execution.plan?.length ? (
        <View style={styles.planWrap}>
          {execution.plan.map((item) => {
            const meta = planTone(item.status);
            return (
              <View key={item.key} style={[styles.planChip, { backgroundColor: meta.bg }]}>
                <Text style={[styles.planChipText, { color: meta.text }]}>{item.label}</Text>
              </View>
            );
          })}
        </View>
      ) : null}

      {execution.clarify?.options?.length ? (
        <View style={styles.clarifyWrap}>
          {execution.clarify.title ? <Text style={styles.clarifyTitle}>{execution.clarify.title}</Text> : null}
          {execution.clarify.prompt ? <Text style={styles.clarifyPrompt}>{execution.clarify.prompt}</Text> : null}
          <ClarifyActions
            options={execution.clarify.options}
            disabled={disabled}
            onPressOption={onPressQuickAction}
          />
        </View>
      ) : null}

      {steps.length ? (
        <View style={styles.stepsWrap}>
          {steps.map((step) => (
            <StepCard
              key={step.id}
              step={step}
              expanded={Boolean(expandedIds[step.id])}
              onToggle={() =>
                setExpandedIds((prev) => ({
                  ...prev,
                  [step.id]: !prev[step.id],
                }))
              }
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: "100%",
    gap: 10,
    marginTop: 8,
  },
  planWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  planChip: {
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  planChipText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  clarifyWrap: {
    gap: 8,
    borderRadius: radius.md,
    backgroundColor: "#F6F9FF",
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  clarifyTitle: {
    color: "#1F2837",
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  clarifyPrompt: {
    color: "#6B7A8E",
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fontFamily.body,
  },
  actionWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  actionChip: {
    borderRadius: radius.pill,
    backgroundColor: "#EAF2FF",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  actionChipDisabled: {
    opacity: 0.48,
  },
  actionChipText: {
    color: palette.accentStrong,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  stepsWrap: {
    width: "100%",
    gap: 8,
  },
  stepWrap: {
    width: "100%",
    gap: 6,
  },
  stepRow: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    minHeight: 44,
    gap: 10,
    overflow: "hidden",
    borderRadius: radius.md,
    backgroundColor: "#F7F9FC",
    borderWidth: 1,
    borderColor: "#E2E8F1",
    paddingHorizontal: 12,
  },
  stepRunning: {
    borderColor: "#BFD4FF",
    backgroundColor: "#F3F8FF",
  },
  stepFailed: {
    borderColor: "#F3CFCF",
    backgroundColor: "#FFF7F7",
  },
  stepIndicatorWrap: {
    width: 12,
    height: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  stepIndicator: {
    width: 8,
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: "#A9B5C6",
  },
  stepIndicatorRunning: {
    backgroundColor: palette.accentStrong,
  },
  stepIndicatorFailed: {
    backgroundColor: "#C05858",
  },
  stepIndicatorCompleted: {
    backgroundColor: "#3E855E",
  },
  stepInlineText: {
    flex: 1,
    color: "#1F2837",
    fontSize: 13,
    lineHeight: 17,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  stepDetailCard: {
    borderRadius: radius.md,
    backgroundColor: "#FCFDFE",
    borderWidth: 1,
    borderColor: "#E6EBF3",
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  stepDetailScroll: {
    maxHeight: 220,
  },
  stepDetailContent: {
    gap: 8,
  },
  detailLine: {
    color: "#5B687A",
    fontSize: 12,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  glowWrap: {
    overflow: "hidden",
  },
  glowGradient: {
    width: 140,
    height: "100%",
  },
  pressed: {
    opacity: 0.92,
  },
});
