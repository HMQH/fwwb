import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  AuthBackdrop,
  authApi,
  guardianMeta,
  roleMeta,
  useAuth,
  type LocalImageAsset,
} from "@/features/auth";
import { ApiError, resolveApiFileUrl } from "@/shared/api";
import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";
import { ManagedImage as Image } from "@/shared/ui/ManagedImage";

const fallbackAvatar = require("../../../../assets/images/anti-fraud-logo.png");

function maskPhone(phone: string) {
  if (phone.length !== 11) {
    return phone;
  }

  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}

const guardianOptions = ["self", "parent", "spouse", "child", "relative"] as const;

const quickEntries = [
  {
    icon: "account-multiple-outline",
    title: "监护人管理",
  },
  {
    icon: "shield-check-outline",
    title: "安全报告",
  },
  {
    icon: "bell-ring-outline",
    title: "风险消息",
  },
  {
    icon: "cog-outline",
    title: "设置中心",
  },
] as const;

const serviceEntries = [
  {
    icon: "help-circle-outline",
    title: "帮助中心",
  },
  {
    icon: "shield-lock-outline",
    title: "账号安全",
  },
  {
    icon: "file-document-outline",
    title: "隐私与协议",
  },
] as const;

export default function ProfileScreen() {
  const { user, token, signOut, refreshCurrentUser } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [savingGuardian, setSavingGuardian] = useState(false);
  const [guardianError, setGuardianError] = useState<string | null>(null);

  const currentRole = useMemo(() => {
    if (!user) {
      return null;
    }

    return roleMeta[user.role];
  }, [user]);

  const avatarUri = resolveApiFileUrl(user?.avatar_url);

  if (!user || !currentRole || !token) {
    return null;
  }

  const selectedGuardian = user.guardian_relation ?? (user.role === "minor" ? "parent" : "self");
  const selectedMeta = guardianMeta[selectedGuardian];

  const stats = [
    { label: "守护模式", value: currentRole.label },
    { label: "监护关系", value: selectedMeta.label },
    { label: "手机号", value: maskPhone(user.phone) },
  ];

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
    }
  };

  const handleSelectGuardian = async (guardianRelation: (typeof guardianOptions)[number]) => {
    if (guardianRelation === selectedGuardian || savingGuardian) {
      return;
    }

    setSavingGuardian(true);
    setGuardianError(null);

    try {
      await authApi.updateGuardian({ guardian_relation: guardianRelation }, token);
      await refreshCurrentUser();
    } catch (error) {
      setGuardianError(error instanceof Error ? error.message : "监护人设置失败，请稍后重试");
    } finally {
      setSavingGuardian(false);
    }
  };

  const handlePickAvatar = async () => {
    if (uploadingAvatar) {
      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("需要相册权限", "请在系统设置中允许访问相册后再更换头像。");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });

    if (result.canceled || !result.assets[0]) {
      return;
    }

    const asset = result.assets[0];
    const fileName = asset.fileName?.trim() || `avatar-${Date.now()}.jpg`;
    const mimeType = asset.mimeType || "image/jpeg";
    const file: LocalImageAsset = {
      uri: asset.uri,
      name: fileName,
      mimeType,
    };

    setUploadingAvatar(true);
    try {
      await authApi.uploadAvatar(file, token);
      await refreshCurrentUser();
    } catch (error) {
      const message =
        error instanceof ApiError ? error.message : "头像上传失败，请稍后重试";
      Alert.alert("上传失败", message);
    } finally {
      setUploadingAvatar(false);
    }
  };

  return (
    <View style={styles.root}>
      <AuthBackdrop />
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.headerCard}>
            <View style={styles.profileTop}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="更换头像"
                hitSlop={{ top: 6, right: 10, bottom: 10, left: 6 }}
                onPress={() => void handlePickAvatar()}
                disabled={uploadingAvatar}
                style={({ pressed }) => [
                  styles.avatarOuter,
                  pressed && !uploadingAvatar && styles.buttonPressed,
                  uploadingAvatar && styles.buttonDisabled,
                ]}
              >
                <View style={styles.avatarWrap}>
                  <Image
                    source={avatarUri ? { uri: avatarUri } : fallbackAvatar}
                    style={styles.avatar}
                    resizeMode="cover"
                    imagePreset="avatar"
                  />
                  {uploadingAvatar ? (
                    <View style={styles.avatarLoadingOverlay}>
                      <ActivityIndicator color={palette.white} />
                    </View>
                  ) : null}
                </View>
                <View style={styles.avatarEditBadge} pointerEvents="none">
                  <MaterialCommunityIcons name="camera" size={16} color={palette.inkInverse} />
                </View>
              </Pressable>

              <View style={styles.profileMeta}>
                <Text style={styles.profileName}>{user.display_name}</Text>
                <View style={styles.rolePill}>
                  <Text style={styles.rolePillText}>{currentRole.label}</Text>
                </View>
                <Text style={styles.profileLine}>{selectedMeta.label}</Text>
              </View>
            </View>

            <View style={styles.statsRow}>
              {stats.map((item) => (
                <View key={item.label} style={styles.statCard}>
                  <Text style={styles.statValue}>{item.value}</Text>
                  <Text style={styles.statLabel}>{item.label}</Text>
                </View>
              ))}
            </View>
          </View>

          <View style={styles.quickGrid}>
            {quickEntries.map((item) => (
              <View key={item.title} style={styles.quickCard}>
                <View style={styles.quickIconWrap}>
                  <MaterialCommunityIcons name={item.icon} size={20} color={palette.accentStrong} />
                </View>
                <Text style={styles.quickTitle}>{item.title}</Text>
              </View>
            ))}
          </View>

          <View style={styles.managementCard}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>监护人管理</Text>
              {savingGuardian ? <Text style={styles.cardStatus}>保存中…</Text> : null}
            </View>

            <View style={styles.guardianList}>
              {guardianOptions.map((item) => {
                const meta = guardianMeta[item];
                const active = selectedGuardian === item;

                return (
                  <Pressable
                    key={item}
                    onPress={() => void handleSelectGuardian(item)}
                    style={({ pressed }) => [
                      styles.guardianOption,
                      active && styles.guardianOptionActive,
                      pressed && styles.guardianOptionPressed,
                    ]}
                  >
                    <Text style={[styles.guardianLabel, active && styles.guardianLabelActive]}>
                      {meta.label}
                    </Text>
                    <Text style={[styles.guardianDetail, active && styles.guardianDetailActive]}>
                      {meta.detail}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {guardianError ? <Text style={styles.guardianError}>{guardianError}</Text> : null}
          </View>

          <View style={styles.serviceCard}>
            {serviceEntries.map((item, index) => (
              <View key={item.title} style={[styles.serviceRow, index < serviceEntries.length - 1 && styles.rowDivider]}>
                <View style={styles.serviceIconWrap}>
                  <MaterialCommunityIcons name={item.icon} size={20} color={palette.accentStrong} />
                </View>
                <Text style={styles.serviceTitle}>{item.title}</Text>
                <MaterialCommunityIcons name="chevron-right" size={20} color={palette.lineStrong} />
              </View>
            ))}
          </View>

          <Pressable
            onPress={handleSignOut}
            disabled={signingOut}
            style={({ pressed }) => [
              styles.logoutButton,
              pressed && styles.buttonPressed,
              signingOut && styles.buttonDisabled,
            ]}
          >
            <MaterialCommunityIcons name="logout-variant" size={18} color={palette.inkInverse} />
            <Text style={styles.logoutText}>{signingOut ? "退出中…" : "退出登录"}</Text>
          </Pressable>
        </ScrollView>
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
  content: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 24,
    gap: 16,
  },
  headerCard: {
    borderRadius: radius.xl,
    paddingHorizontal: 18,
    paddingVertical: 18,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    gap: 18,
    ...panelShadow,
  },
  profileTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  avatarOuter: {
    width: 76,
    height: 76,
    position: "relative",
  },
  avatarWrap: {
    width: 76,
    height: 76,
    borderRadius: 38,
    overflow: "hidden",
    backgroundColor: palette.accentSoft,
    borderWidth: 2,
    borderColor: palette.white,
  },
  avatar: {
    width: "100%",
    height: "100%",
  },
  avatarLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.38)",
    justifyContent: "center",
    alignItems: "center",
  },
  avatarEditBadge: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: palette.accent,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: palette.white,
    ...panelShadow,
  },
  profileMeta: {
    flex: 1,
    gap: 6,
  },
  profileName: {
    color: palette.ink,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  rolePill: {
    alignSelf: "flex-start",
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: palette.accentSoft,
  },
  rolePillText: {
    color: palette.accentStrong,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  profileLine: {
    color: palette.inkSoft,
    fontSize: 13,
    lineHeight: 19,
    fontFamily: fontFamily.body,
  },
  statsRow: {
    flexDirection: "row",
    gap: 10,
  },
  statCard: {
    flex: 1,
    minHeight: 82,
    borderRadius: radius.lg,
    paddingHorizontal: 12,
    paddingVertical: 14,
    backgroundColor: palette.surfaceSoft,
    borderWidth: 1,
    borderColor: palette.line,
    justifyContent: "space-between",
  },
  statValue: {
    color: palette.ink,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  statLabel: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 17,
    fontFamily: fontFamily.body,
  },
  quickGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  quickCard: {
    width: "48%",
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 16,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    gap: 12,
    ...panelShadow,
  },
  quickIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: palette.accentSoft,
  },
  quickTitle: {
    color: palette.ink,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  managementCard: {
    borderRadius: radius.lg,
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    gap: 14,
    ...panelShadow,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  cardTitle: {
    color: palette.ink,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  cardStatus: {
    color: palette.accentStrong,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  guardianList: {
    gap: 10,
  },
  guardianOption: {
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 14,
    backgroundColor: palette.surfaceSoft,
    borderWidth: 1,
    borderColor: palette.line,
    gap: 4,
  },
  guardianOptionActive: {
    backgroundColor: palette.accent,
    borderColor: palette.accent,
  },
  guardianOptionPressed: {
    opacity: 0.9,
  },
  guardianLabel: {
    color: palette.ink,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  guardianLabelActive: {
    color: palette.inkInverse,
  },
  guardianDetail: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  guardianDetailActive: {
    color: "rgba(255,255,255,0.86)",
  },
  guardianError: {
    color: palette.accentStrong,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  serviceCard: {
    borderRadius: radius.lg,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    overflow: "hidden",
    ...panelShadow,
  },
  serviceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  rowDivider: {
    borderBottomWidth: 1,
    borderColor: palette.line,
  },
  serviceIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: palette.accentSoft,
  },
  serviceTitle: {
    flex: 1,
    color: palette.ink,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  logoutButton: {
    minHeight: 52,
    borderRadius: radius.pill,
    backgroundColor: palette.accent,
    justifyContent: "center",
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    ...panelShadow,
  },
  logoutText: {
    color: palette.inkInverse,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  buttonPressed: {
    opacity: 0.9,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});
