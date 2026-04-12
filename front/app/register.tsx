import { Redirect, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { AuthInput, TogglePill } from "@/components/auth/AuthInput";
import { AuthShell } from "@/components/auth/AuthShell";
import { LoadingScreen } from "@/components/auth/LoadingScreen";
import { fontFamily, palette, radius } from "@/constants/theme";
import {
  formatBirthDateInput,
  normalizePhone,
  validateRegister,
  type RegisterFormErrors,
  type RegisterFormValues,
} from "@/lib/validation";
import { useAuth } from "@/providers/AuthProvider";
import { API_BASE, API_BASE_IS_DEFAULT, ApiError, authApi } from "@/services/api";

const highlights = [
  {
    eyebrow: "01",
    title: "注册成功后直接返回 access_token",
    detail: "与你的后端实现方案一致，少一步跳转，能更快进入主界面。",
  },
  {
    eyebrow: "02",
    title: "生日仅用于后端自动识别角色",
    detail: "child / youth / elder 的判断都在服务端完成，前端只负责采集合法日期。",
  },
  {
    eyebrow: "03",
    title: "协议勾选前不会放行提交",
    detail: "在前端先挡住无效表单，减少 422 校验错误，提升演示稳定性。",
  },
];

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
    return <LoadingScreen label="正在确认当前是否已登录…" />;
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
      eyebrow="NEW PROFILE"
      title="先建好个人档案，再把后续防护接进来。"
      description="注册表单严格对齐后端接口：手机号、密码、确认密码、生日、昵称、协议勾选。提交成功后会直接返回 access_token 并进入首页。"
      panelTitle="注册"
      panelDescription="生日请按 YYYY-MM-DD 输入。角色识别完全由后端处理，你无需手动选择。"
      highlights={highlights}
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
        hint="与后端一致：11 位，且以 1 开头"
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
        placeholder="例如 13800138000"
        maxLength={11}
        returnKeyType="next"
      />

      <AuthInput
        label="昵称"
        hint="会写入 display_name，不能为空"
        value={values.displayName}
        onChangeText={(text) => {
          clearFieldError("displayName");
          setValues((prev) => ({ ...prev, displayName: text }));
        }}
        error={errors.displayName}
        autoCapitalize="none"
        autoCorrect={false}
        textContentType="nickname"
        placeholder="例如 小周"
        returnKeyType="next"
      />

      <AuthInput
        label="生日"
        hint="格式 YYYY-MM-DD"
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

      <View style={styles.inlineNote}>
        <Text style={styles.inlineNoteText}>
          角色会由后端根据生日自动计算为 child / youth / elder。
        </Text>
      </View>

      <AuthInput
        label="密码"
        hint="至少 8 位，建议同时包含字母和数字"
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
        placeholder="请输入登录密码"
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
        hint="必须与上方密码保持一致"
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
          {submitting ? "正在创建账户…" : "注册并进入"}
        </Text>
      </Pressable>

      <View style={styles.endpointNote}>
        <Text style={styles.endpointLabel}>
          {API_BASE_IS_DEFAULT ? "当前使用默认接口地址" : "当前已读取 .env 接口地址"}
        </Text>
        <Text style={styles.endpointText}>{API_BASE}</Text>
      </View>
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
  inlineNote: {
    marginTop: -2,
    paddingHorizontal: 2,
  },
  inlineNoteText: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 18,
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
  endpointNote: {
    gap: 4,
    paddingTop: 4,
  },
  endpointLabel: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  endpointText: {
    color: palette.accentStrong,
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "700",
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
