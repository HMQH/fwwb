import { ActivityIndicator, Image, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AuthBackdrop } from "./AuthBackdrop";
import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";

const antiFraudLogo = require("../../../assets/images/anti-fraud-logo.png");

export function LoadingScreen({ label = "正在加载中…" }: { label?: string }) {
  return (
    <View style={styles.root}>
      <AuthBackdrop />
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.center}>
          <View style={styles.card}>
            <Image source={antiFraudLogo} style={styles.logo} resizeMode="contain" />
            <ActivityIndicator color={palette.accentStrong} size="small" />
            <Text style={styles.label}>{label}</Text>
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
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  card: {
    width: "100%",
    maxWidth: 280,
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 22,
    paddingVertical: 24,
    borderRadius: radius.xl,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    ...panelShadow,
  },
  logo: {
    width: 52,
    height: 52,
  },
  label: {
    color: palette.inkSoft,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
    fontFamily: fontFamily.body,
  },
});
