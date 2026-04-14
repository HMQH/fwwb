import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import {
  Animated,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AuthBackdrop } from "./AuthBackdrop";
import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";

const antiFraudLogo = require("../../../assets/images/anti-fraud-logo.png");

type AuthShellProps = {
  title: string;
  description?: string;
  /** 为 false 时隐藏顶部 logo、应用名与说明文案，适合分步注册等需腾出空间的页面 */
  showBranding?: boolean;
  children: ReactNode;
  footer?: ReactNode;
  headerAction?: ReactNode;
};

export function AuthShell({
  title,
  description,
  showBranding = true,
  children,
  footer,
  headerAction,
}: AuthShellProps) {
  const { height: windowHeight } = useWindowDimensions();
  const reveal = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(reveal, {
      toValue: 1,
      duration: 360,
      useNativeDriver: true,
    }).start();
  }, [reveal]);

  const revealStyle = useMemo(
    () => ({
      opacity: reveal,
      transform: [
        {
          translateY: reveal.interpolate({
            inputRange: [0, 1],
            outputRange: [18, 0],
          }),
        },
      ],
    }),
    [reveal]
  );

  return (
    <View style={styles.root}>
      <AuthBackdrop />

      <SafeAreaView style={styles.flex} edges={["top", "bottom"]}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.flex}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={[
              styles.scrollContent,
              {
                minHeight: showBranding
                  ? Math.max(windowHeight * 0.92, 520)
                  : Math.max(windowHeight * 0.72, 420),
              },
            ]}
            showsVerticalScrollIndicator={false}
          >
            <Animated.View
              style={[styles.shell, showBranding ? revealStyle : undefined, !showBranding && styles.shellCompact]}
            >
              <View style={styles.topBar}>
                <View style={styles.actionSlot}>{headerAction}</View>
              </View>

              {showBranding ? (
                <View style={styles.logoBlock}>
                  <View style={styles.logoRing}>
                    <Image source={antiFraudLogo} style={styles.logo} resizeMode="contain" />
                  </View>
                  <Text style={styles.brandName}>反诈守护</Text>
                  <View style={styles.pageTag}>
                    <MaterialCommunityIcons
                      name="shield-check-outline"
                      size={14}
                      color={palette.accentStrong}
                    />
                    <Text style={styles.pageTagText}>{title}</Text>
                  </View>
                  {description ? <Text style={styles.description}>{description}</Text> : null}
                </View>
              ) : null}

              <View style={styles.panel}>
                <View style={styles.formStack}>{children}</View>

                {footer ? <View style={styles.footer}>{footer}</View> : null}
              </View>
            </Animated.View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: palette.background,
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "flex-start",
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 40,
  },
  shell: {
    width: "100%",
    maxWidth: 420,
    alignSelf: "center",
    gap: 18,
  },
  shellCompact: {
    gap: 10,
  },
  topBar: {
    minHeight: 40,
    justifyContent: "center",
  },
  actionSlot: {
    width: 40,
    height: 40,
    justifyContent: "center",
  },
  logoBlock: {
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 8,
  },
  logoRing: {
    width: 112,
    height: 112,
    borderRadius: 56,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: palette.white,
    borderWidth: 1,
    borderColor: palette.line,
    ...panelShadow,
  },
  logo: {
    width: 84,
    height: 84,
  },
  brandName: {
    color: palette.ink,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  pageTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: palette.accentSoft,
  },
  pageTagText: {
    color: palette.accentStrong,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  description: {
    maxWidth: 260,
    color: palette.inkSoft,
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
    fontFamily: fontFamily.body,
  },
  panel: {
    borderRadius: radius.xl,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 20,
    paddingVertical: 22,
    gap: 16,
    ...panelShadow,
  },
  formStack: {
    gap: 14,
  },
  footer: {
    marginTop: 4,
  },
});
