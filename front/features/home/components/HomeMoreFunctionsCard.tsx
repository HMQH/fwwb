import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";

import type { HomeFunctionEntry } from "../config/functionCatalog";

export function HomeMoreFunctionsCard({
  entries,
}: {
  entries: HomeFunctionEntry[];
}) {
  const router = useRouter();

  return (
    <View style={styles.card}>
      <Text style={styles.title}>更多功能</Text>
      <View style={styles.grid}>
        {entries.map((entry) => (
          <Pressable
            key={entry.title}
            onPress={() => router.push(entry.route as never)}
            style={({ pressed }) => [
              styles.item,
              pressed && styles.itemPressed,
            ]}
          >
            <View style={[styles.iconWrap, { backgroundColor: entry.soft }]}>
              <MaterialCommunityIcons
                name={entry.icon}
                size={18}
                color={entry.tint}
              />
            </View>
            <Text style={styles.label} numberOfLines={2}>
              {entry.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 10,
    gap: 14,
    ...panelShadow,
  },
  title: {
    color: palette.ink,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  item: {
    width: "20%",
    alignItems: "center",
    gap: 8,
    paddingBottom: 14,
  },
  itemPressed: {
    opacity: 0.88,
  },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    color: palette.ink,
    fontSize: 10,
    lineHeight: 13,
    textAlign: "center",
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
});
