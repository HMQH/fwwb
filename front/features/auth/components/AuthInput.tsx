import { MaterialCommunityIcons } from "@expo/vector-icons";
import { forwardRef, useState, type ReactNode } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput as RNTextInput,
  type TextInputProps,
  View,
} from "react-native";

import { fontFamily, palette, radius } from "@/shared/theme";

type AuthInputProps = TextInputProps & {
  label?: string;
  hint?: string;
  error?: string;
  accessory?: ReactNode;
  leadingIcon?: keyof typeof MaterialCommunityIcons.glyphMap;
};

export const AuthInput = forwardRef<RNTextInput, AuthInputProps>(function AuthInput(
  { label, hint, error, accessory, leadingIcon, onFocus, onBlur, ...props },
  ref
) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.wrapper}>
      {label || hint ? (
        <View style={styles.metaBlock}>
          {label ? <Text style={styles.label}>{label}</Text> : null}
          {hint ? <Text style={styles.hint}>{hint}</Text> : null}
        </View>
      ) : null}

      <View style={[styles.field, focused && styles.fieldFocused, !!error && styles.fieldError]}>
        {leadingIcon ? (
          <View style={styles.leadingIcon}>
            <MaterialCommunityIcons
              name={leadingIcon}
              size={18}
              color={focused ? palette.accentStrong : palette.lineStrong}
            />
          </View>
        ) : null}

        <RNTextInput
          {...props}
          ref={ref}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          style={styles.input}
          placeholderTextColor={palette.inkSoft}
          selectionColor={palette.accentStrong}
          cursorColor={palette.accentStrong}
        />

        {accessory ? <View style={styles.accessory}>{accessory}</View> : null}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
});

AuthInput.displayName = "AuthInput";

export function TogglePill({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.toggle, pressed && styles.togglePressed]}
    >
      <Text style={styles.toggleLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: 8,
  },
  metaBlock: {
    gap: 2,
  },
  label: {
    color: palette.ink,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
    letterSpacing: 0.2,
    fontFamily: fontFamily.body,
  },
  hint: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  field: {
    minHeight: 56,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.surfaceSoft,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  fieldFocused: {
    borderColor: palette.accent,
    backgroundColor: palette.white,
  },
  fieldError: {
    borderColor: palette.accentStrong,
    backgroundColor: palette.dangerSoft,
  },
  leadingIcon: {
    width: 20,
    alignItems: "center",
  },
  input: {
    flex: 1,
    color: palette.ink,
    fontSize: 15,
    lineHeight: 20,
    paddingVertical: 16,
    fontFamily: fontFamily.body,
  },
  accessory: {
    justifyContent: "center",
    alignItems: "center",
  },
  error: {
    color: palette.accentStrong,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  toggle: {
    minHeight: 32,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: palette.accentSoft,
  },
  togglePressed: {
    opacity: 0.82,
  },
  toggleLabel: {
    color: palette.accentStrong,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
});
