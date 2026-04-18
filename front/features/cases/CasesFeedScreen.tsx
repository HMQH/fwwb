import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { fontFamily, palette, radius } from "@/shared/theme";

export default function CasesFeedScreen() {
  const router = useRouter();

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <View style={styles.navBar}>
          <Pressable style={styles.navButton} onPress={() => router.back()}>
            <MaterialCommunityIcons name="chevron-left" size={22} color={palette.ink} />
          </Pressable>
          <Text style={styles.navTitle}>案例库</Text>
          <View style={styles.navPlaceholder} />
        </View>

        <View style={styles.content}>
          <View style={styles.card}>
            <View style={styles.iconWrap}>
              <MaterialCommunityIcons name="book-open-page-variant-outline" size={24} color={palette.accentStrong} />
            </View>
            <Text style={styles.title}>案例库建设中</Text>
            <Text style={styles.meta}>稍后开放</Text>
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: palette.background,
  },
  safeArea: {
    flex: 1,
  },
  navBar: {
    height: 52,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  navButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
  },
  navTitle: {
    color: palette.ink,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  navPlaceholder: {
    width: 36,
    height: 36,
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  card: {
    alignItems: "center",
    gap: 12,
    borderRadius: radius.xl,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 20,
    paddingVertical: 24,
  },
  iconWrap: {
    width: 54,
    height: 54,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.accentSoft,
  },
  title: {
    color: palette.ink,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  meta: {
    color: palette.inkSoft,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
});
