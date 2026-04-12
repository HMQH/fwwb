import { useEffect, useMemo, useRef, type ReactNode } from "react";
import {
  Animated,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import { AuthBackdrop } from "@/components/auth/AuthBackdrop";
import { fontFamily, palette, panelShadow, radius } from "@/constants/theme";

type HighlightItem = {
  eyebrow: string;
  title: string;
  detail: string;
};

type AuthShellProps = {
  eyebrow: string;
  title: string;
  description: string;
  panelTitle: string;
  panelDescription: string;
  highlights: HighlightItem[];
  children: ReactNode;
  footer?: ReactNode;
};

export function AuthShell({
  eyebrow,
  title,
  description,
  panelTitle,
  panelDescription,
  highlights,
  children,
  footer,
}: AuthShellProps) {
  const { width } = useWindowDimensions();
  const isWide = width >= 980;
  const reveal = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(reveal, {
      toValue: 1,
      duration: 650,
      useNativeDriver: true,
    }).start();
  }, [reveal]);

  const heroAnimation = useMemo(
    () => ({
      opacity: reveal,
      transform: [
        {
          translateY: reveal.interpolate({
            inputRange: [0, 1],
            outputRange: [28, 0],
          }),
        },
      ],
    }),
    [reveal]
  );

  return (
    <View style={styles.root}>
      <AuthBackdrop />

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[
            styles.scrollContent,
            { paddingHorizontal: width >= 640 ? 28 : 18 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <Animated.View style={[styles.shell, isWide && styles.shellWide, heroAnimation]}>
            <View style={[styles.editorial, isWide && styles.editorialWide]}>
              <View style={styles.eyebrowRow}>
                <Text style={styles.eyebrow}>{eyebrow}</Text>
                <View style={styles.eyebrowDot} />
              </View>

              <Text style={styles.title}>{title}</Text>
              <Text style={styles.description}>{description}</Text>

              <View style={styles.memoStrip}>
                <Text style={styles.memoKicker}>身份校验并不只是进入系统</Text>
                <Text style={styles.memoText}>
                  这个入口会先建立信任感，再把登录、注册、角色识别三件事一次做清楚。
                </Text>
              </View>

              <View style={styles.highlightList}>
                {highlights.map((item, index) => (
                  <View
                    key={`${item.eyebrow}-${item.title}`}
                    style={[styles.highlightRow, index === 0 && styles.highlightRowFirst]}
                  >
                    <Text style={styles.highlightEyebrow}>{item.eyebrow}</Text>
                    <View style={styles.highlightContent}>
                      <Text style={styles.highlightTitle}>{item.title}</Text>
                      <Text style={styles.highlightDetail}>{item.detail}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>

            <View style={[styles.panel, isWide && styles.panelWide]}>
              <View style={styles.panelSeal} />
              <Text style={styles.panelTitle}>{panelTitle}</Text>
              <Text style={styles.panelDescription}>{panelDescription}</Text>

              <View style={styles.formStack}>{children}</View>

              {footer ? <View style={styles.footer}>{footer}</View> : null}
            </View>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
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
    justifyContent: "center",
    paddingVertical: 28,
  },
  shell: {
    width: "100%",
    maxWidth: 1180,
    alignSelf: "center",
    gap: 24,
  },
  shellWide: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 34,
  },
  editorial: {
    gap: 22,
  },
  editorialWide: {
    flex: 1,
    paddingTop: 36,
  },
  eyebrowRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  eyebrow: {
    color: palette.accentStrong,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 2.2,
    textTransform: "uppercase",
    fontFamily: fontFamily.display,
  },
  eyebrowDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: palette.warm,
  },
  title: {
    maxWidth: 480,
    color: palette.ink,
    fontSize: 42,
    lineHeight: 48,
    fontWeight: "800",
    letterSpacing: -1.2,
    fontFamily: fontFamily.display,
  },
  description: {
    maxWidth: 360,
    color: palette.inkSoft,
    fontSize: 16,
    lineHeight: 26,
    fontFamily: fontFamily.body,
  },
  memoStrip: {
    gap: 6,
    paddingVertical: 18,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: palette.line,
  },
  memoKicker: {
    color: palette.ink,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  memoText: {
    color: palette.inkSoft,
    fontSize: 14,
    lineHeight: 22,
    fontFamily: fontFamily.body,
  },
  highlightList: {
    gap: 14,
  },
  highlightRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    borderColor: palette.line,
  },
  highlightRowFirst: {
    paddingTop: 0,
    borderTopWidth: 0,
  },
  highlightEyebrow: {
    width: 54,
    color: palette.lineStrong,
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: 1.8,
    fontWeight: "800",
    textTransform: "uppercase",
    fontFamily: fontFamily.display,
  },
  highlightContent: {
    flex: 1,
    gap: 3,
  },
  highlightTitle: {
    color: palette.ink,
    fontSize: 17,
    lineHeight: 24,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  highlightDetail: {
    color: palette.inkSoft,
    fontSize: 14,
    lineHeight: 22,
    fontFamily: fontFamily.body,
  },
  panel: {
    position: "relative",
    width: "100%",
    maxWidth: 460,
    padding: 22,
    gap: 18,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.surface,
    alignSelf: "flex-start",
    overflow: "hidden",
    ...panelShadow,
  },
  panelWide: {
    flexBasis: 460,
  },
  panelSeal: {
    position: "absolute",
    top: -16,
    right: -8,
    width: 92,
    height: 92,
    borderRadius: 999,
    backgroundColor: palette.accentSoft,
    opacity: 0.85,
  },
  panelTitle: {
    color: palette.ink,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: "800",
    letterSpacing: -0.5,
    fontFamily: fontFamily.display,
  },
  panelDescription: {
    color: palette.inkSoft,
    fontSize: 14,
    lineHeight: 22,
    fontFamily: fontFamily.body,
  },
  formStack: {
    gap: 16,
  },
  footer: {
    marginTop: 4,
    paddingTop: 18,
    borderTopWidth: 1,
    borderColor: palette.line,
  },
});
