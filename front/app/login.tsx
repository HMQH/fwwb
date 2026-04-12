import { Redirect, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { AuthInput, TogglePill } from "@/components/auth/AuthInput";
import { AuthShell } from "@/components/auth/AuthShell";
import { LoadingScreen } from "@/components/auth/LoadingScreen";
import { fontFamily, palette, radius } from "@/constants/theme";
import {
  normalizePhone,
  validateLogin,
  type LoginFormErrors,
  type LoginFormValues,
} from "@/lib/validation";
import { useAuth } from "@/providers/AuthProvider";
import { API_BASE, API_BASE_IS_DEFAULT, ApiError, authApi } from "@/services/api";

const highlights = [
  {
    eyebrow: "01",
    title: "统一校验手机号与密码",
    detail: "前端先做格式检查，后端再做统一错误返回，避免无谓的重复试错。",
  },
  {
    eyebrow: "02",
    title: "登录成功后直接写入安全存储",
    detail: "access_token 会被保存在 secure-store，本地重启后仍可自动恢复会话。",
  },
  {
    eyebrow: "03",
    title: "默认保持浅色、克制、可信",
    detail: "适合反诈场景：少一点后台感，多一点稳妥与保护感。",
  },
];

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
    return <LoadingScreen label="正在检查是否已有有效会话…" />;
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
      eyebrow="SAFE ACCESS"
      title="先让账户通行，再把守护感建立起来。"
      description="这是反诈助手的登录入口。手机号和密码通过后，会自动恢复你的会话，并在进入主界面前完成一次令牌校验。"
      panelTitle="登录"
      panelDescription="输入手机号与密码即可进入。若在真机调试，请记得把 .env 中的 EXPO_PUBLIC_API_BASE_URL 改成电脑局域网 IP。"
      highlights={highlights}
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
        hint="支持大陆 11 位手机号"
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
        label="密码"
        hint="后端会统一返回“手机号或密码错误”"
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
        placeholder="请输入你的登录密码"
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
          {submitting ? "正在核验…" : "登录并进入"}
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
  endpointNote: {
    gap: 4,
    paddingTop: 6,
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
