import { Redirect, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  AuthInput,
  AuthShell,
  LoadingScreen,
  TogglePill,
  authApi,
  normalizePhone,
  useAuth,
  validateLogin,
  type LoginFormErrors,
  type LoginFormValues,
} from "@/features/auth";
import { ApiError } from "@/shared/api";
import { fontFamily, palette, radius } from "@/shared/theme";

export default function LoginScreen() {
  const router = useRouter();
  const { status, signIn } = useAuth();

  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [values, setValues] = useState<LoginFormValues>({
    phone: "",
    password: "",
  });
  const [errors, setErrors] = useState<LoginFormErrors>({});

  if (status === "loading") {
    return <LoadingScreen label="加载中…" />;
  }

  if (status === "authenticated") {
    return <Redirect href="/" />;
  }

  const clearFieldError = (field: keyof LoginFormValues) => {
    setErrors((prev) => ({
      ...prev,
      [field]: undefined,
      form: undefined,
    }));
  };

  const handleSubmit = async () => {
    const nextErrors = validateLogin(values);
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    setSubmitting(true);
    setErrors({});

    try {
      const session = await authApi.login(values);
      await signIn(session);
      router.replace("/");
    } catch (error) {
      setErrors({
        form: error instanceof ApiError ? error.message : "登录失败，请稍后重试",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      eyebrow="登录"
      title="欢迎回来"
      panelTitle="登录"
      footer={
        <View style={styles.footerRow}>
          <Text style={styles.footerText}>还没有账户？</Text>
          <Pressable onPress={() => router.push("/register")}>
            <Text style={styles.footerLink}>去注册</Text>
          </Pressable>
        </View>
      }
    >
      {errors.form ? (
        <View style={styles.messageBox}>
          <Text style={styles.messageText}>{errors.form}</Text>
        </View>
      ) : null}

      <AuthInput
        label="手机号"
        hint="11 位手机号"
        value={values.phone}
        onChangeText={(text) => {
          clearFieldError("phone");
          setValues((prev) => ({ ...prev, phone: normalizePhone(text) }));
        }}
        error={errors.phone}
        keyboardType="number-pad"
        autoCapitalize="none"
        autoCorrect={false}
        textContentType="telephoneNumber"
        placeholder="请输入手机号"
        maxLength={11}
        returnKeyType="next"
      />

      <AuthInput
        label="密码"
        value={values.password}
        onChangeText={(text) => {
          clearFieldError("password");
          setValues((prev) => ({ ...prev, password: text }));
        }}
        error={errors.password}
        secureTextEntry={!showPassword}
        autoCapitalize="none"
        autoCorrect={false}
        textContentType="password"
        placeholder="请输入密码"
        returnKeyType="done"
        onSubmitEditing={handleSubmit}
        accessory={
          <TogglePill
            label={showPassword ? "隐藏" : "显示"}
            onPress={() => setShowPassword((prev) => !prev)}
          />
        }
      />

      <Pressable
        onPress={handleSubmit}
        disabled={submitting}
        style={({ pressed }) => [
          styles.primaryButton,
          pressed && styles.primaryButtonPressed,
          submitting && styles.primaryButtonDisabled,
        ]}
      >
        <Text style={styles.primaryButtonText}>
          {submitting ? "登录中…" : "登录"}
        </Text>
      </Pressable>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  messageBox: {
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "#f7e7df",
    borderWidth: 1,
    borderColor: "#e7c0af",
  },
  messageText: {
    color: palette.danger,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: fontFamily.body,
  },
  primaryButton: {
    minHeight: 56,
    borderRadius: radius.pill,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: palette.ink,
    paddingHorizontal: 18,
  },
  primaryButtonPressed: {
    opacity: 0.88,
  },
  primaryButtonDisabled: {
    opacity: 0.56,
  },
  primaryButtonText: {
    color: palette.white,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "800",
    letterSpacing: 0.3,
    fontFamily: fontFamily.body,
  },
  footerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  footerText: {
    color: palette.inkSoft,
    fontSize: 14,
    lineHeight: 22,
    fontFamily: fontFamily.body,
  },
  footerLink: {
    color: palette.accentStrong,
    fontSize: 14,
    lineHeight: 22,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
});
