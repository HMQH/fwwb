import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { fontFamily } from "@/shared/theme";

import type { HomeFunctionEntry } from "../config/functionCatalog";
import { HomeFunctionIconGlass } from "./HomeFunctionIconGlass";

export function HomePrimaryModesCard({
  entries,
}: {
  entries: HomeFunctionEntry[];
}) {
  const router = useRouter();
  const rows =
    entries.length > 3 ? [entries.slice(0, 3), entries.slice(3)] : [entries];

  return (
    <View style={styles.card}>
      <LinearGradient
        colors={["rgba(255,255,255,0.92)", "rgba(246,250,255,0.72)"]}
        start={{ x: 0.08, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.cardFill}
      />
      <View style={styles.cardHighlight} />

      <View style={styles.rows}>
        {rows.map((rowEntries, rowIndex) => (
          <View
            key={`row-${rowIndex}`}
            style={[
              styles.row,
              rowEntries.length === 2 && styles.rowTwoColumns,
            ]}
          >
            {rowEntries.map((entry) => (
              <Pressable
                key={entry.title}
                onPress={() => router.push(entry.route as never)}
                style={({ pressed }) => [
                  styles.entry,
                  pressed && styles.entryPressed,
                ]}
              >
                <View style={styles.entryContent}>
                  <HomeFunctionIconGlass soft={entry.soft} outerSize={48} borderRadius={14}>
                    <MaterialCommunityIcons
                      name={entry.icon}
                      size={24}
                      color={entry.tint}
                    />
                  </HomeFunctionIconGlass>

                  <Text style={styles.label}>{entry.label}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: "relative",
    overflow: "hidden",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(220, 231, 247, 0.96)",
    backgroundColor: "rgba(255,255,255,0.58)",
    paddingHorizontal: 8,
    paddingVertical: 8,
    shadowColor: "#C7DDFB",
    shadowOpacity: 0.26,
    shadowRadius: 20,
    shadowOffset: {
      width: 0,
      height: 10,
    },
    elevation: 10,
  },
  cardFill: {
    ...StyleSheet.absoluteFillObject,
  },
  cardHighlight: {
    position: "absolute",
    top: 1,
    left: 12,
    right: 12,
    height: 1,
    backgroundColor: "rgba(255,255,255,0.94)",
  },
  rows: {
    gap: 6,
  },
  row: {
    flexDirection: "row",
    gap: 8,
  },
  rowTwoColumns: {
    paddingHorizontal: 18,
  },
  entry: {
    position: "relative",
    flex: 1,
    minHeight: 88,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 6,
    borderRadius: 18,
  },
  entryPressed: {
    transform: [{ scale: 0.98 }],
  },
  entryContent: {
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  label: {
    color: "#234A78",
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
});
