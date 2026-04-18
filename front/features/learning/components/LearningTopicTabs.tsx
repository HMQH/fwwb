import { Pressable, ScrollView, StyleSheet, Text } from "react-native";

import { fontFamily, palette, radius } from "@/shared/theme";

type TabItem<T extends string> = {
  key: T;
  label: string;
};

type Props<T extends string> = {
  items: readonly TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
};

export function LearningTopicTabs<T extends string>({ items, value, onChange }: Props<T>) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {items.map((item) => {
        const active = item.key === value;
        return (
          <Pressable
            key={item.key}
            style={({ pressed }) => [
              styles.chip,
              active && styles.chipActive,
              pressed && styles.pressed,
            ]}
            onPress={() => onChange(item.key)}
          >
            <Text style={[styles.chipText, active && styles.chipTextActive]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: 10,
    paddingRight: 16,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radius.pill,
    backgroundColor: "#F6F8FC",
  },
  chipActive: {
    backgroundColor: palette.accentSoft,
  },
  chipText: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  chipTextActive: {
    color: palette.accentStrong,
  },
  pressed: {
    opacity: 0.84,
  },
});
