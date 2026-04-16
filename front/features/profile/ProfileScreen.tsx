import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
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
  roleMeta,
  useAuth,
  type LocalImageAsset,
} from "@/features/auth";
import { ApiError, resolveApiFileUrl } from "@/shared/api";
import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";

const fallbackAvatar = require("../../assets/images/anti-fraud-logo.png");

const quickEntries = [
  { icon: "account-details-outline", title: "用户画像", route: "/profile-memory" as const },
  { icon: "folder-multiple-image", title: "上传管理", route: "/uploads" as const },
  { icon: "account-network-outline", title: "关系记忆", route: "/relations" as const },
  { icon: "account-group-outline", title: "监护人", route: "/guardians" as const },
] as const;

const serviceEntries = [
  { icon: "help-circle-outline", title: "帮助中心" },
  { icon: "shield-lock-outline", title: "账号安全" },
  { icon: "file-document-outline", title: "隐私协议" },
] as const;

export default function ProfileScreen() {
  const router = useRouter();
  const { user, token, signOut, refreshCurrentUser } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

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

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
    }
  };

  const handlePickAvatar = async () => {
    if (uploadingAvatar) {
      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("需要相册权限", "请先允许访问相册");
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
    const file: LocalImageAsset = {
      uri: asset.uri,
      name: asset.fileName?.trim() || `avatar-${Date.now()}.jpg`,
      mimeType: asset.mimeType || "image/jpeg",
    };

    setUploadingAvatar(true);
    try {
      await authApi.uploadAvatar(file, token);
      await refreshCurrentUser();
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "头像上传失败";
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
                  <Image source={avatarUri ? { uri: avatarUri } : fallbackAvatar} style={styles.avatar} resizeMode="cover" />
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
              </View>
            </View>
          </View>

          <View style={styles.quickGrid}>
            {quickEntries.map((item) => (
              <Pressable
                key={item.title}
                onPress={() => router.push(item.route as never)}
                style={({ pressed }) => [styles.quickCard, styles.quickCardInteractive, pressed && styles.buttonPressed]}
              >
                <View style={styles.quickIconWrap}>
                  <MaterialCommunityIcons name={item.icon} size={20} color={palette.accentStrong} />
                </View>
                <View style={styles.quickTitleRow}>
                  <Text style={styles.quickTitle}>{item.title}</Text>
                  <MaterialCommunityIcons name="chevron-right" size={18} color={palette.lineStrong} />
                </View>
              </Pressable>
            ))}
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
  root: { flex: 1, backgroundColor: palette.background },
  safeArea: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 24, gap: 16 },
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
  profileTop: { flexDirection: "row", alignItems: "center", gap: 14 },
  avatarOuter: { width: 76, height: 76, position: "relative" },
  avatarWrap: {
    width: 76,
    height: 76,
    borderRadius: 38,
    overflow: "hidden",
    backgroundColor: palette.accentSoft,
    borderWidth: 2,
    borderColor: palette.white,
  },
  avatar: { width: "100%", height: "100%" },
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
  profileMeta: { flex: 1, gap: 6 },
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
  quickGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
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
  quickCardInteractive: { justifyContent: "space-between" },
  quickIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: palette.accentSoft,
  },
  quickTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  quickTitle: {
    color: palette.ink,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "700",
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
  rowDivider: { borderBottomWidth: 1, borderColor: palette.line },
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
  buttonPressed: { opacity: 0.9 },
  buttonDisabled: { opacity: 0.6 },
});
