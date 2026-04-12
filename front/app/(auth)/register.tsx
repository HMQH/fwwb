import { Redirect, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  AuthInput,
  AuthShell,
  LoadingScreen,
  TogglePill,
  authApi,
  formatBirthDateInput,
  normalizePhone,
  useAuth,
  validateRegister,
  type RegisterFormErrors,
  type RegisterFormValues,
} from "@/features/auth";
import { ApiError } from "@/shared/api";
import { fontFamily, palette, radius } from "@/shared/theme";

export default function RegisterScreen() {
  const router = useRouter();
  const { status, signIn } = useAuth();

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [values, setValues] = useState<RegisterFormValues>({
    phone: "",
    displayName: "",
    birthDate: "",
    password: "",
    passwordConfirm: "",
    agreeTerms: false,
  });
  const [errors, setErrors] = useState<RegisterFormErrors>({});

  if (status === "loading") {
    return <LoadingScreen label="加载中…" />;
  }

  if (status === "authenticated") {
    return <Redirect href="/" />;
  }

  const clearFieldError = (field: keyof RegisterFormValues) => {
    setErrors((prev) => ({
      ...prev,
      [field]: undefined,
      form: undefined,
    }));
  };

  const handleSubmit = async () => {
    const nextErrors = validateRegister(values);
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    setSubmitting(true);
    setErrors({});

    try {
      const session = await authApi.register({
        phone: values.phone,
        password: values.password,
        password_confirm: values.passwordConfirm,
        birth_date: values.birthDate,
        display_name: values.displayName.trim(),
        agree_terms: values.agreeTerms,
      });

      await signIn(session);
      router.replace("/");
    } catch (error) {
      setErrors({
        form: error instanceof ApiError ? error.message : "注册失败，请稍后重试",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      eyebrow="注册"
      title="创建账户"
      panelTitle="注册"
      footer={
        <View style={styles.footerRow}>
          <Text style={styles.footerText}>已经有账户？</Text>
          <Pressable onPress={() => router.replace("/login")}>
            <Text style={styles.footerLink}>去登录</Text>
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
        label="昵称"
        value={values.displayName}
        onChangeText={(text) => {
          clearFieldError("displayName");
          setValues((prev) => ({ ...prev, displayName: text }));
        }}
        error={errors.displayName}
        autoCapitalize="none"
        autoCorrect={false}
        textContentType="nickname"
        placeholder="请输入昵称"
        returnKeyType="next"
      />

      <AuthInput
        label="生日"
        hint="YYYY-MM-DD"
        value={values.birthDate}
        onChangeText={(text) => {
          clearFieldError("birthDate");
          setValues((prev) => ({
            ...prev,
            birthDate: formatBirthDateInput(text),
          }));
        }}
        error={errors.birthDate}
        keyboardType="number-pad"
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="例如 1998-04-12"
        maxLength={10}
        returnKeyType="next"
      />

      <AuthInput
        label="密码"
        hint="至少 8 位"
        value={values.password}
        onChangeText={(text) => {
          clearFieldError("password");
          setValues((prev) => ({ ...prev, password: text }));
        }}
        error={errors.password}
        secureTextEntry={!showPassword}
        autoCapitalize="none"
        autoCorrect={false}
        textContentType="newPassword"
        placeholder="请输入密码"
        returnKeyType="next"
        accessory={
          <TogglePill
            label={showPassword ? "隐藏" : "显示"}
            onPress={() => setShowPassword((prev) => !prev)}
          />
        }
      />

      <AuthInput
        label="确认密码"
        value={values.passwordConfirm}
        onChangeText={(text) => {
          clearFieldError("passwordConfirm");
          setValues((prev) => ({ ...prev, passwordConfirm: text }));
        }}
        error={errors.passwordConfirm}
        secureTextEntry={!showConfirmPassword}
        autoCapitalize="none"
        autoCorrect={false}
        textContentType="password"
        placeholder="再次输入密码"
        returnKeyType="done"
        onSubmitEditing={handleSubmit}
        accessory={
          <TogglePill
            label={showConfirmPassword ? "隐藏" : "显示"}
            onPress={() => setShowConfirmPassword((prev) => !prev)}
          />
        }
      />

      <Pressable
        onPress={() => {
          clearFieldError("agreeTerms");
          setValues((prev) => ({ ...prev, agreeTerms: !prev.agreeTerms }));
        }}
        style={({ pressed }) => [
          styles.checkboxRow,
          pressed && styles.checkboxRowPressed,
          errors.agreeTerms && styles.checkboxRowError,
        ]}
      >
        <View style={[styles.checkbox, values.agreeTerms && styles.checkboxChecked]}>
          {values.agreeTerms ? <Text style={styles.checkboxTick}>✓</Text> : null}
        </View>
        <Text style={styles.checkboxText}>我已阅读并同意用户协议与隐私政策</Text>
      </Pressable>

      {errors.agreeTerms ? <Text style={styles.checkboxError}>{errors.agreeTerms}</Text> : null}

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
          {submitting ? "注册中…" : "注册"}
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
  checkboxRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 8,
  },
  checkboxRowPressed: {
    opacity: 0.8,
  },
  checkboxRowError: {
    opacity: 0.95,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: palette.lineStrong,
    backgroundColor: palette.white,
    justifyContent: "center",
    alignItems: "center",
  },
  checkboxChecked: {
    borderColor: palette.accent,
    backgroundColor: palette.accent,
  },
  checkboxTick: {
    color: palette.white,
    fontSize: 13,
    lineHeight: 16,
    fontWeight: "800",
  },
  checkboxText: {
    flex: 1,
    color: palette.ink,
    fontSize: 14,
    lineHeight: 21,
    fontFamily: fontFamily.body,
  },
  checkboxError: {
    marginTop: -8,
    color: palette.danger,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  primaryButton: {
    minHeight: 56,
    borderRadius: radius.pill,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: palette.accentStrong,
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
