import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { Redirect, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  AuthInput,
  AuthShell,
  LoadingScreen,
  TogglePill,
  authApi,
  formatBirthDateInput,
  isValidBirthDate,
  normalizePhone,
  roleOptions,
  useAuth,
  validateRegister,
  type LocalImageAsset,
  type RegisterFormErrors,
  type RegisterFormValues,
  type UserRole,
} from "@/features/auth";
import { ApiError } from "@/shared/api";
import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";

const fallbackAvatar = require("../../assets/images/anti-fraud-logo.png");

const stepItems = [
  {
    key: "avatar",
    title: "上传头像",
    subtitle: "注册时可直接上传头像",
  },
  {
    key: "phone",
    title: "填写手机号",
    subtitle: "手机号将用于登录和身份识别",
  },
  {
    key: "displayName",
    title: "填写昵称",
    subtitle: "昵称会显示在个人中心顶部",
  },
  {
    key: "birthDate",
    title: "填写生日",
    subtitle: "生日用于完善基础信息",
  },
  {
    key: "role",
    title: "选择角色",
    subtitle: "你可以直接选择当前使用角色",
  },
  {
    key: "password",
    title: "设置密码",
    subtitle: "至少 8 位，便于后续登录",
  },
  {
    key: "confirm",
    title: "确认注册",
    subtitle: "最后确认密码并完成注册",
  },
] as const;

type StepKey = (typeof stepItems)[number]["key"];

export default function RegisterScreen() {
  const router = useRouter();
  const phoneRef = useRef<TextInput>(null);
  const nameRef = useRef<TextInput>(null);
  const birthDateRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmPasswordRef = useRef<TextInput>(null);
  const { status, signIn } = useAuth();

  const translateX = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [avatar, setAvatar] = useState<LocalImageAsset | null>(null);
  const [values, setValues] = useState<RegisterFormValues>({
    phone: "",
    displayName: "",
    birthDate: "",
    role: "",
    password: "",
    passwordConfirm: "",
    agreeTerms: false,
  });
  const [errors, setErrors] = useState<RegisterFormErrors>({});

  const currentStep = stepItems[stepIndex];
  const progress = ((stepIndex + 1) / stepItems.length) * 100;

  useEffect(() => {
    const timer = setTimeout(() => {
      if (currentStep.key === "phone") {
        phoneRef.current?.focus();
      }
      if (currentStep.key === "displayName") {
        nameRef.current?.focus();
      }
      if (currentStep.key === "birthDate") {
        birthDateRef.current?.focus();
      }
      if (currentStep.key === "password") {
        passwordRef.current?.focus();
      }
      if (currentStep.key === "confirm") {
        confirmPasswordRef.current?.focus();
      }
    }, 180);

    return () => clearTimeout(timer);
  }, [currentStep.key]);

  if (status === "loading") {
    return <LoadingScreen label="正在确认账户状态…" />;
  }

  if (status === "authenticated") {
    return <Redirect href="/" />;
  }

  const clearFieldError = (field: keyof RegisterFormValues | "form") => {
    setErrors((prev) => ({
      ...prev,
      [field]: undefined,
      form: field === "form" ? undefined : prev.form,
    }));
  };

  const animateToStep = (nextIndex: number) => {
    const direction = nextIndex > stepIndex ? 1 : -1;

    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 0,
        duration: 120,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(translateX, {
        toValue: direction * -22,
        duration: 120,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start(() => {
      translateX.setValue(direction * 22);
      opacity.setValue(0);
      setStepIndex(nextIndex);

      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 220,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(translateX, {
          toValue: 0,
          duration: 220,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();
    });
  };

  const handlePickAvatar = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setErrors((prev) => ({
        ...prev,
        form: "请允许访问相册后再上传头像",
      }));
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (result.canceled || !result.assets[0]) {
      return;
    }

    const asset = result.assets[0];
    setAvatar({
      uri: asset.uri,
      name: asset.fileName?.trim() || `avatar-${Date.now()}.jpg`,
      mimeType: asset.mimeType || "image/jpeg",
    });
    clearFieldError("form");
  };

  const validateCurrentStep = (step: StepKey) => {
    const nextErrors: RegisterFormErrors = {};

    if (step === "phone" && !/^1\d{10}$/.test(values.phone)) {
      nextErrors.phone = "请输入以 1 开头的 11 位手机号";
    }

    if (step === "displayName" && !values.displayName.trim()) {
      nextErrors.displayName = "昵称不能为空";
    }

    if (step === "birthDate" && !isValidBirthDate(values.birthDate)) {
      nextErrors.birthDate = "请输入合法生日，格式为 YYYY-MM-DD";
    }

    if (step === "role" && !values.role) {
      nextErrors.role = "请选择角色";
    }

    if (step === "password" && values.password.length < 8) {
      nextErrors.password = "密码至少需要 8 位";
    }

    if (step === "confirm") {
      if (values.passwordConfirm !== values.password) {
        nextErrors.passwordConfirm = "两次输入的密码不一致";
      }
      if (!values.agreeTerms) {
        nextErrors.agreeTerms = "请先同意用户协议与隐私政策";
      }
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors((prev) => ({
        ...prev,
        ...nextErrors,
      }));
      return false;
    }

    return true;
  };

  const handleNext = () => {
    clearFieldError("form");
    if (!validateCurrentStep(currentStep.key)) {
      return;
    }

    if (stepIndex < stepItems.length - 1) {
      animateToStep(stepIndex + 1);
    }
  };

  const handleBack = () => {
    clearFieldError("form");
    if (stepIndex > 0) {
      animateToStep(stepIndex - 1);
    } else {
      router.replace("/login");
    }
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
        role: values.role as UserRole,
        agree_terms: values.agreeTerms,
        avatar_file: avatar,
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

  let stepContent: React.ReactNode;

  if (currentStep.key === "avatar") {
    stepContent = (
      <Pressable
        onPress={handlePickAvatar}
        style={({ pressed }) => [
          styles.heroCard,
          pressed && styles.heroCardPressed,
        ]}
      >
        <View style={styles.avatarPreviewWrap}>
          <Image
            source={avatar ? { uri: avatar.uri } : fallbackAvatar}
            style={styles.avatarPreview}
            resizeMode="cover"
          />
        </View>
        <View style={styles.heroCardBody}>
          <Text style={styles.heroCardTitle}>上传头像</Text>
          <Text style={styles.heroCardDetail}>
            {avatar ? "头像已选择，可继续下一步" : "点击从相册选择一张头像"}
          </Text>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={20} color={palette.lineStrong} />
      </Pressable>
    );
  } else if (currentStep.key === "phone") {
    stepContent = (
      <AuthInput
        ref={phoneRef}
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
        returnKeyType="done"
        onSubmitEditing={handleNext}
      />
    );
  } else if (currentStep.key === "displayName") {
    stepContent = (
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
        returnKeyType="done"
        onSubmitEditing={handleNext}
      />
    );
  } else if (currentStep.key === "birthDate") {
    stepContent = (
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
        returnKeyType="done"
        onSubmitEditing={handleNext}
      />
    );
  } else if (currentStep.key === "role") {
    stepContent = (
      <View style={styles.roleList}>
        {roleOptions.map((item) => {
          const active = values.role === item.value;

          return (
            <Pressable
              key={item.value}
              onPress={() => {
                clearFieldError("role");
                setValues((prev) => ({ ...prev, role: item.value }));
              }}
              style={({ pressed }) => [
                styles.roleCard,
                active && styles.roleCardActive,
                pressed && styles.roleCardPressed,
              ]}
            >
              <View style={[styles.roleImageWrap, { backgroundColor: item.soft }]}>
                <Image source={item.image} style={styles.roleImage} resizeMode="cover" />
              </View>
              <View style={styles.roleBody}>
                <Text style={[styles.roleTitle, active && styles.roleTitleActive]}>
                  {item.label}
                </Text>
              </View>
            </Pressable>
          );
        })}
        {errors.role ? <Text style={styles.inlineError}>{errors.role}</Text> : null}
      </View>
    );
  } else if (currentStep.key === "password") {
    stepContent = (
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
        returnKeyType="done"
        onSubmitEditing={handleNext}
        accessory={
          <TogglePill
            label={showPassword ? "隐藏" : "显示"}
            onPress={() => setShowPassword((prev) => !prev)}
          />
        }
      />
    );
  } else {
    stepContent = (
      <View style={styles.confirmBlock}>
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
        {errors.agreeTerms ? <Text style={styles.inlineError}>{errors.agreeTerms}</Text> : null}
      </View>
    );
  }

  return (
    <AuthShell showBranding={false} title="" headerAction={
        <Pressable
          onPress={handleBack}
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

      <View style={styles.progressBlock}>
        <View style={styles.progressMeta}>
          <Text style={styles.progressTitle}>{currentStep.title}</Text>
          <Text style={styles.progressCount}>
            {stepIndex + 1}/{stepItems.length}
          </Text>
        </View>
        <Text style={styles.progressSubtitle}>{currentStep.subtitle}</Text>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress}%` }]} />
        </View>
      </View>

      <Animated.View
        key={currentStep.key}
        style={[
          styles.stepCard,
          {
            opacity,
            transform: [{ translateX }],
          },
        ]}
      >
        {stepContent}
      </Animated.View>

      <View style={styles.actionsRow}>
        <Pressable onPress={handleBack} style={({ pressed }) => [styles.secondaryButton, pressed && styles.secondaryButtonPressed]}>
          <Text style={styles.secondaryButtonText}>{stepIndex === 0 ? "返回" : "上一步"}</Text>
        </Pressable>

        {stepIndex === stepItems.length - 1 ? (
          <Pressable
            onPress={handleSubmit}
            disabled={submitting}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.primaryButtonPressed,
              submitting && styles.primaryButtonDisabled,
            ]}
          >
            <Text style={styles.primaryButtonText}>{submitting ? "注册中…" : "完成注册"}</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={handleNext}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryButtonPressed]}
          >
            <Text style={styles.primaryButtonText}>下一步</Text>
          </Pressable>
        )}
      </View>

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
  progressBlock: {
    gap: 8,
  },
  progressMeta: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  progressTitle: {
    color: palette.ink,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  progressCount: {
    color: palette.accentStrong,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  progressSubtitle: {
    color: palette.inkSoft,
    fontSize: 13,
    lineHeight: 19,
    fontFamily: fontFamily.body,
  },
  progressTrack: {
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: palette.surfaceSoft,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: radius.pill,
    backgroundColor: palette.accent,
  },
  stepCard: {
    minHeight: 212,
    justifyContent: "center",
  },
  heroCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 18,
    borderRadius: radius.lg,
    backgroundColor: palette.surfaceSoft,
    borderWidth: 1,
    borderColor: palette.line,
  },
  heroCardPressed: {
    opacity: 0.92,
  },
  avatarPreviewWrap: {
    width: 66,
    height: 66,
    borderRadius: 33,
    overflow: "hidden",
    backgroundColor: palette.accentSoft,
  },
  avatarPreview: {
    width: "100%",
    height: "100%",
  },
  heroCardBody: {
    flex: 1,
    gap: 4,
  },
  heroCardTitle: {
    color: palette.ink,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  heroCardDetail: {
    color: palette.inkSoft,
    fontSize: 13,
    lineHeight: 19,
    fontFamily: fontFamily.body,
  },
  roleList: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  roleCard: {
    width: "48%",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: radius.lg,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
  },
  roleCardActive: {
    backgroundColor: palette.accent,
    borderColor: palette.accent,
  },
  roleCardPressed: {
    opacity: 0.92,
  },
  roleImageWrap: {
    width: "100%",
    height: 128,
    borderRadius: 18,
    overflow: "hidden",
  },
  roleImage: {
    width: "100%",
    height: "100%",
  },
  roleBody: {
    gap: 6,
  },
  roleTitle: {
    color: palette.ink,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  roleTitleActive: {
    color: palette.inkInverse,
  },
  confirmBlock: {
    gap: 12,
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
  inlineError: {
    color: palette.accentStrong,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  actionsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  secondaryButton: {
    minHeight: 52,
    flex: 1,
    borderRadius: radius.pill,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: palette.surfaceSoft,
    borderWidth: 1,
    borderColor: palette.line,
  },
  secondaryButtonPressed: {
    opacity: 0.9,
  },
  secondaryButtonText: {
    color: palette.ink,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  primaryButton: {
    minHeight: 52,
    flex: 1.45,
    borderRadius: radius.pill,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: palette.accent,
    ...panelShadow,
  },
  primaryButtonPressed: {
    opacity: 0.92,
  },
  primaryButtonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    color: palette.inkInverse,
    fontSize: 15,
    lineHeight: 20,
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
