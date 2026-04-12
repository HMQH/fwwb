import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Redirect, useRouter } from "expo-router";
import { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

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
  const nameRef = useRef<TextInput>(null);
  const birthDateRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmPasswordRef = useRef<TextInput>(null);
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
    return <LoadingScreen label="正在确认账户状态…" />;
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
      title="创建账户"
      description="填写基础信息即可开始使用。"
      headerAction={
        <Pressable
          onPress={() => router.replace("/login")}
          style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
        >
          <MaterialCommunityIcons name="chevron-left" size={22} color={palette.accentStrong} />
        </Pressable>
      }
    >
      {errors.form ? (
        <View style={styles.messageBox}>
          <Text style={styles.messageText}>{errors.form}</Text>
        </View>
      ) : null}

      <AuthInput
        leadingIcon="cellphone"
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
        onSubmitEditing={() => nameRef.current?.focus()}
      />

      <AuthInput
        ref={nameRef}
        leadingIcon="account-outline"
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
        onSubmitEditing={() => birthDateRef.current?.focus()}
      />

      <AuthInput
        ref={birthDateRef}
        leadingIcon="calendar-month-outline"
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
        placeholder="请输入生日 YYYY-MM-DD"
        maxLength={10}
        returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()}
      />

      <AuthInput
        ref={passwordRef}
        leadingIcon="lock-outline"
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
        onSubmitEditing={() => confirmPasswordRef.current?.focus()}
        accessory={
          <TogglePill
            label={showPassword ? "隐藏" : "显示"}
            onPress={() => setShowPassword((prev) => !prev)}
          />
        }
      />

      <AuthInput
        ref={confirmPasswordRef}
        leadingIcon="shield-key-outline"
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
        placeholder="请再次输入密码"
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
          {values.agreeTerms ? (
            <MaterialCommunityIcons name="check" size={14} color={palette.inkInverse} />
          ) : null}
        </View>
        <Text style={styles.checkboxText}>我已阅读并同意《用户协议》《隐私政策》</Text>
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
        <Text style={styles.primaryButtonText}>{submitting ? "注册中…" : "注册"}</Text>
      </Pressable>

      <View style={styles.footerRow}>
        <Text style={styles.footerText}>已有账号？</Text>
        <Pressable onPress={() => router.replace("/login")}>
          <Text style={styles.footerLink}>返回登录</Text>
        </Pressable>
      </View>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
  },
  backButtonPressed: {
    opacity: 0.82,
  },
  messageBox: {
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: palette.dangerSoft,
    borderWidth: 1,
    borderColor: palette.line,
  },
  messageText: {
    color: palette.accentStrong,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: fontFamily.body,
  },
  checkboxRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: radius.md,
    backgroundColor: palette.surfaceSoft,
    borderWidth: 1,
    borderColor: palette.line,
  },
  checkboxRowPressed: {
    opacity: 0.88,
  },
  checkboxRowError: {
    borderColor: palette.accentStrong,
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
  checkboxText: {
    flex: 1,
    color: palette.ink,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: fontFamily.body,
  },
  checkboxError: {
    marginTop: -6,
    color: palette.accentStrong,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  primaryButton: {
    minHeight: 54,
    borderRadius: radius.pill,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: palette.accent,
    paddingHorizontal: 18,
    marginTop: 4,
  },
  primaryButtonPressed: {
    opacity: 0.9,
  },
  primaryButtonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    color: palette.inkInverse,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  footerRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
    paddingTop: 2,
  },
  footerText: {
    color: palette.inkSoft,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: fontFamily.body,
  },
  footerLink: {
    color: palette.accentStrong,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
});
