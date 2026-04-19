import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { fontFamily, radius } from "@/shared/theme";

import type { HomeFunctionEntry } from "../config/functionCatalog";
import { HomeFunctionIconGlass } from "./HomeFunctionIconGlass";

export function HomeMoreFunctionsCard({
  entries,
}: {
  entries: HomeFunctionEntry[];
}) {
  const router = useRouter();

  return (
    <View style={styles.card}>
      <LinearGradient
        colors={["rgba(255,255,255,0.92)", "rgba(246,250,255,0.72)"]}
        start={{ x: 0.08, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.cardFill}
      />
      <View style={styles.cardHighlight} />

      <View style={styles.titlePill}>
        <LinearGradient
          colors={["rgba(255,255,255,0.92)", "rgba(247,251,255,0.66)"]}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.titlePillFill}
        />
        <Text style={styles.title}>更多功能</Text>
      </View>
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
            <View style={styles.itemContent}>
              <HomeFunctionIconGlass soft={entry.soft} outerSize={40} borderRadius={12}>
                <MaterialCommunityIcons
                  name={entry.icon}
                  size={20}
                  color={entry.tint}
                />
              </HomeFunctionIconGlass>
              <Text style={styles.label} numberOfLines={2}>
                {entry.label}
              </Text>
            </View>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: "relative",
    overflow: "hidden",
    borderRadius: 30,
    borderWidth: 1,
    borderColor: "rgba(220, 231, 247, 0.96)",
    backgroundColor: "rgba(255,255,255,0.58)",
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 10,
    gap: 14,
    shadowColor: "#C7DDFB",
    shadowOpacity: 0.24,
    shadowRadius: 24,
    shadowOffset: {
      width: 0,
      height: 14,
    },
    elevation: 10,
  },
  cardFill: {
    ...StyleSheet.absoluteFillObject,
  },
  cardHighlight: {
    position: "absolute",
    top: 1,
    left: 18,
    right: 18,
    height: 1,
    backgroundColor: "rgba(255,255,255,0.94)",
  },
  titlePill: {
    position: "relative",
    alignSelf: "flex-start",
    overflow: "hidden",
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: "rgba(221, 232, 248, 0.92)",
    backgroundColor: "rgba(255,255,255,0.56)",
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  titlePillFill: {
    ...StyleSheet.absoluteFillObject,
  },
  title: {
    color: "#234A78",
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: 16,
  },
  item: {
    position: "relative",
    width: "20%",
    alignItems: "center",
    gap: 10,
    paddingBottom: 6,
    paddingTop: 2,
    borderRadius: 18,
  },
  itemPressed: {
    transform: [{ scale: 0.97 }],
  },
  itemContent: {
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  label: {
    color: "#406285",
    fontSize: 10,
    lineHeight: 13,
    textAlign: "center",
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
});
