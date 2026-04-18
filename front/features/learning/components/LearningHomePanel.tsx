import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";

import type { LearningTopicKey, LearningTopicSummary } from "../types";
import { LearningTopicTabs } from "./LearningTopicTabs";

type Props = {
  topics: LearningTopicSummary[];
  activeTopic: LearningTopicSummary;
  onChangeTopic: (value: LearningTopicKey) => void;
  onOpenQuiz: () => void;
  onOpenSimulation: () => void;
};

function MetaChip({ label }: { label: string }) {
  return (
    <View style={styles.metaChip}>
      <Text style={styles.metaChipText}>{label}</Text>
    </View>
  );
}

export function LearningHomePanel({
  topics,
  activeTopic,
  onChangeTopic,
  onOpenQuiz,
  onOpenSimulation,
}: Props) {
  return (
    <View style={styles.wrap}>
      <LearningTopicTabs items={topics} value={activeTopic.key} onChange={onChangeTopic} />

      <Pressable style={({ pressed }) => [styles.actionCard, pressed && styles.pressed]} onPress={onOpenQuiz}>
        <View style={styles.cardTop}>
          <View style={styles.cardIconWrap}>
            <MaterialCommunityIcons name="checkbox-marked-circle-outline" size={20} color={palette.accentStrong} />
          </View>
          <Text style={styles.cardTitle}>刷题</Text>
        </View>
        <View style={styles.metaRow}>
          <MetaChip label={activeTopic.label} />
          <MetaChip label={`${activeTopic.quiz_count} 题`} />
        </View>
        <View style={styles.cardFoot}>
          <Text style={styles.cardAction}>开始刷题</Text>
          <MaterialCommunityIcons name="arrow-right" size={16} color={palette.accentStrong} />
        </View>
      </Pressable>

      <Pressable
        style={({ pressed }) => [styles.actionCard, pressed && styles.pressed]}
        onPress={onOpenSimulation}
      >
        <View style={styles.cardTop}>
          <View style={styles.cardIconWrap}>
            <MaterialCommunityIcons name="account-voice" size={20} color={palette.accentStrong} />
          </View>
          <Text style={styles.cardTitle}>AI模拟诈骗</Text>
        </View>
        <View style={styles.metaRow}>
          <MetaChip label={activeTopic.label} />
          <MetaChip label={activeTopic.simulation_persona} />
        </View>
        <View style={styles.cardFoot}>
          <Text style={styles.cardAction}>开始模拟</Text>
          <MaterialCommunityIcons name="arrow-right" size={16} color={palette.accentStrong} />
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 14,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 24,
  },
  actionCard: {
    borderRadius: radius.lg,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 14,
    ...panelShadow,
  },
  cardTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  cardIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.accentSoft,
  },
  cardTitle: {
    color: palette.ink,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  metaChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: palette.surfaceSoft,
  },
  metaChipText: {
    color: palette.inkSoft,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  cardFoot: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cardAction: {
    color: palette.accentStrong,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  pressed: {
    opacity: 0.92,
  },
});
