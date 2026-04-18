import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";

import type { HomeFunctionEntry } from "../config/functionCatalog";

export function HomePrimaryModesCard({
  entries,
}: {
  entries: HomeFunctionEntry[];
}) {
  const router = useRouter();

  return (
    <View style={styles.card}>
      {entries.map((entry, index) => (
        <Pressable
          key={entry.title}
          onPress={() => router.push(entry.route as never)}
          style={({ pressed }) => [
            styles.entry,
            index === 0 && styles.entryDivider,
            pressed && styles.entryPressed,
          ]}
        >
          <View style={[styles.iconWrap, { backgroundColor: entry.soft }]}>
            <MaterialCommunityIcons
              name={entry.icon}
              size={22}
              color={entry.tint}
            />
          </View>
          <Text style={styles.label}>{entry.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    borderRadius: radius.lg,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    overflow: "hidden",
    ...panelShadow,
  },
  entry: {
    flex: 1,
    minHeight: 118,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
  },
  entryDivider: {
    borderRightWidth: 1,
    borderRightColor: palette.line,
  },
  entryPressed: {
    opacity: 0.9,
  },
  iconWrap: {
    width: 54,
    height: 54,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    color: palette.ink,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
});
