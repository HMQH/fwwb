import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AuthBackdrop } from "@/components/auth/AuthBackdrop";
import { fontFamily, palette } from "@/constants/theme";

export function LoadingScreen({ label = "正在准备守护入口…" }: { label?: string }) {
  return (
    <View style={styles.root}>
      <AuthBackdrop />
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.center}>
          <ActivityIndicator color={palette.accent} size="small" />
          <Text style={styles.label}>{label}</Text>
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
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 24,
  },
  label: {
    color: palette.inkSoft,
    fontSize: 14,
    lineHeight: 22,
    fontFamily: fontFamily.body,
  },
});
