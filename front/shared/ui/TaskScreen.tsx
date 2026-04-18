import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";

type TaskScreenProps = {
  title: string;
  children: ReactNode;
  footer: ReactNode;
  cardStyle?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
};

type TaskPrimaryButtonProps = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
};

export function TaskPrimaryButton({
  label,
  onPress,
  disabled = false,
  loading = false,
}: TaskPrimaryButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.primaryButton,
        (disabled || loading) && styles.primaryButtonDisabled,
        pressed && !disabled && !loading && styles.primaryButtonPressed,
      ]}
    >
      <Text style={styles.primaryButtonText}>{loading ? "处理中" : label}</Text>
    </Pressable>
  );
}

export function TaskScreen({
  title,
  children,
  footer,
  cardStyle,
  contentStyle,
}: TaskScreenProps) {
  const router = useRouter();

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <KeyboardAvoidingView
          style={styles.keyboard}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={[styles.content, contentStyle]}>
            <View style={styles.header}>
              <Pressable
                style={({ pressed }) => [
                  styles.backButton,
                  pressed && styles.backButtonPressed,
                ]}
                onPress={() => router.replace("/" as never)}
              >
                <MaterialCommunityIcons
                  name="chevron-left"
                  size={20}
                  color={palette.accentStrong}
                />
              </Pressable>
              <Text style={styles.title} numberOfLines={1}>
                {title}
              </Text>
            </View>

            <View style={[styles.card, cardStyle]}>{children}</View>

            <View style={styles.footer}>{footer}</View>
          </View>
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
  safeArea: {
    flex: 1,
  },
  keyboard: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 18,
    gap: 14,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  backButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
  },
  backButtonPressed: {
    opacity: 0.88,
  },
  title: {
    flex: 1,
    color: palette.ink,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  card: {
    flex: 1,
    borderRadius: radius.lg,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 16,
    paddingVertical: 16,
    ...panelShadow,
  },
  footer: {
    paddingBottom: 4,
  },
  primaryButton: {
    minHeight: 48,
    borderRadius: radius.pill,
    backgroundColor: palette.accentStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonPressed: {
    opacity: 0.9,
  },
  primaryButtonDisabled: {
    opacity: 0.46,
  },
  primaryButtonText: {
    color: palette.inkInverse,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
});
