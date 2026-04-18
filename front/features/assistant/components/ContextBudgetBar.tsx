import { StyleSheet, Text, View } from "react-native";

import { fontFamily, palette, radius } from "@/shared/theme";

import type { AssistantContextBudget } from "../types";

function toneColor(level: AssistantContextBudget["pressure_level"]) {
  if (level === "overflow" || level === "critical") {
    return "#D15B5B";
  }
  if (level === "high") {
    return "#C9792B";
  }
  if (level === "watch") {
    return palette.accentStrong;
  }
  return "#4E8D69";
}

function formatPercent(progress: number) {
  const value = Math.max(0, progress) * 100;
  if (value <= 0) {
    return "0%";
  }
  if (value < 0.1) {
    return "0.1%";
  }
  if (value < 10) {
    return `${value.toFixed(1)}%`;
  }
  return `${Math.round(value)}%`;
}

function formatCompactTokenLimit(value: number) {
  if (value >= 1000) {
    const kilo = value / 1000;
    if (Number.isInteger(kilo)) {
      return `${kilo}k`;
    }
    return `${kilo.toFixed(1)}k`;
  }
  return `${value}`;
}

export function ContextBudgetBar({ budget }: { budget: AssistantContextBudget | null }) {
  if (!budget) {
    return null;
  }

  const progress = Math.max(0, Math.min(1, budget.usage_ratio || 0));
  const tone = toneColor(budget.pressure_level);
  const sourceLabel = budget.usage_source === "prompt_tokens" ? "实测" : "估算";

  return (
    <View style={styles.wrap}>
      <Text style={styles.metaLine} numberOfLines={1} ellipsizeMode="tail">
        上下文 <Text style={[styles.percent, { color: tone }]}>{formatPercent(progress)}</Text>
        <Text style={styles.metaMuted}> · {budget.used_tokens}/{formatCompactTokenLimit(budget.max_tokens)}</Text>
        <Text style={styles.metaMuted}> · {sourceLabel}</Text>
        {budget.compressed ? <Text style={styles.metaMuted}> · 已压缩</Text> : null}
      </Text>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${progress * 100}%`, backgroundColor: tone }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: radius.md,
    backgroundColor: "#F5F8FD",
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 4,
    marginTop: 8,
  },
  metaLine: {
    color: "#425166",
    fontSize: 11,
    lineHeight: 14,
    fontFamily: fontFamily.body,
    fontWeight: "700",
  },
  percent: {
    fontSize: 11,
    lineHeight: 14,
    fontFamily: fontFamily.body,
    fontWeight: "800",
  },
  metaMuted: {
    color: "#6E7D90",
    fontSize: 11,
    lineHeight: 14,
    fontFamily: fontFamily.body,
    fontWeight: "600",
  },
  track: {
    height: 5,
    borderRadius: radius.pill,
    backgroundColor: "#E2E9F5",
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    borderRadius: radius.pill,
    minWidth: 0,
  },
});
