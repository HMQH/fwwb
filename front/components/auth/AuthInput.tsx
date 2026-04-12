import { useState, type ReactNode } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from "react-native";

import { fontFamily, palette, radius } from "@/constants/theme";

type AuthInputProps = TextInputProps & {
  label: string;
  hint?: string;
  error?: string;
  accessory?: ReactNode;
};

export function AuthInput({
  label,
  hint,
  error,
  accessory,
  onFocus,
  onBlur,
  ...props
}: AuthInputProps) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.wrapper}>
      <View style={styles.metaRow}>
        <Text style={styles.label}>{label}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>

      <View style={[styles.field, focused && styles.fieldFocused, !!error && styles.fieldError]}>
        <TextInput
          {...props}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          style={styles.input}
          placeholderTextColor="#8b8d87"
          selectionColor={palette.accent}
          cursorColor={palette.accent}
        />

        {accessory ? <View style={styles.accessory}>{accessory}</View> : null}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

export function TogglePill({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.toggle, pressed && styles.togglePressed]}>
      <Text style={styles.toggleLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: 8,
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: 12,
  },
  label: {
    color: palette.ink,
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 0.3,
    fontFamily: fontFamily.body,
  },
  hint: {
    flexShrink: 1,
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  field: {
    minHeight: 58,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.white,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  fieldFocused: {
    borderColor: palette.accent,
    backgroundColor: "#fffdf9",
  },
  fieldError: {
    borderColor: palette.danger,
  },
  input: {
    flex: 1,
    color: palette.ink,
    fontSize: 16,
    lineHeight: 22,
    paddingVertical: 16,
    fontFamily: fontFamily.body,
  },
  accessory: {
    justifyContent: "center",
    alignItems: "center",
  },
  error: {
    color: palette.danger,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  toggle: {
    minHeight: 34,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: palette.surfaceStrong,
  },
  togglePressed: {
    opacity: 0.72,
  },
  toggleLabel: {
    color: palette.accentStrong,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.4,
    fontFamily: fontFamily.body,
  },
});
