import { Redirect } from "expo-router";
import { useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AuthBackdrop, LoadingScreen, roleMeta, useAuth } from "@/features/auth";
import { API_BASE, API_BASE_IS_DEFAULT } from "@/shared/api";
import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";

function maskPhone(phone: string) {
  if (phone.length !== 11) {
    return phone;
  }

  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}

export default function Index() {
  const { status, user, signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);

  const currentRole = useMemo(() => {
    if (!user) {
      return null;
    }

    return roleMeta[user.role];
  }, [user]);

  if (status === "loading") {
    return <LoadingScreen label="正在恢复上次会话…" />;
  }

  if (status === "guest" || !user || !currentRole) {
    return <Redirect href="/login" />;
  }

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <View style={styles.root}>
      <AuthBackdrop />

      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.topBar}>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>SECURE HOME</Text>
            </View>

            <Pressable
              onPress={handleSignOut}
              disabled={signingOut}
              style={({ pressed }) => [
                styles.exitButton,
                pressed && styles.buttonPressed,
                signingOut && styles.buttonDisabled,
              ]}
            >
              <Text style={styles.exitButtonText}>
                {signingOut ? "正在退出…" : "退出登录"}
              </Text>
            </Pressable>
          </View>

          <Text style={styles.title}>欢迎回来，{user.display_name}</Text>
          <Text style={styles.subtitle}>
            当前会话已经建立成功。后端会按生日自动识别角色，后续首页业务可以直接接在这里。
          </Text>

          <View style={styles.primarySurface}>
            <View style={styles.primaryMeta}>
              <Text style={styles.sectionEyebrow}>当前身份</Text>
              <Text style={styles.roleTitle}>{currentRole.label}</Text>
              <Text style={styles.roleTone}>{currentRole.tone}</Text>
            </View>

            <View style={styles.timeline}>
              <View style={styles.timelineRow}>
                <Text style={styles.timelineLabel}>手机号</Text>
                <Text style={styles.timelineValue}>{maskPhone(user.phone)}</Text>
              </View>
              <View style={styles.timelineRow}>
                <Text style={styles.timelineLabel}>生日</Text>
                <Text style={styles.timelineValue}>{user.birth_date}</Text>
              </View>
              <View style={styles.timelineRow}>
                <Text style={styles.timelineLabel}>角色说明</Text>
                <Text style={styles.timelineValue}>{currentRole.detail}</Text>
              </View>
            </View>
          </View>

          <View style={styles.secondaryCluster}>
            <View style={[styles.noteSurface, styles.noteSurfaceLeft]}>
              <Text style={styles.sectionEyebrow}>当前状态</Text>
              <Text style={styles.noteTitle}>登录 / 注册已接通</Text>
              <Text style={styles.noteText}>
                现在已经具备 token 存储、自动验签、登录守卫和登出清理。后续只需要把主页业务内容补进来。
              </Text>
            </View>

            <View style={[styles.noteSurface, styles.noteSurfaceRight]}>
              <Text style={styles.sectionEyebrow}>接口地址</Text>
              <Text style={styles.noteTitle}>
                {API_BASE_IS_DEFAULT ? "当前使用默认地址" : "当前读取 .env 地址"}
              </Text>
              <Text style={styles.noteText}>{API_BASE}</Text>
            </View>
          </View>
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
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 28,
    gap: 18,
  },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  badge: {
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 9,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
  },
  badgeText: {
    color: palette.accentStrong,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.6,
    fontFamily: fontFamily.display,
  },
  exitButton: {
    minHeight: 42,
    borderRadius: radius.pill,
    paddingHorizontal: 16,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: palette.ink,
  },
  exitButtonText: {
    color: palette.white,
    fontSize: 14,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  buttonPressed: {
    opacity: 0.8,
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  title: {
    color: palette.ink,
    fontSize: 34,
    lineHeight: 40,
    fontWeight: "800",
    letterSpacing: -0.8,
    fontFamily: fontFamily.display,
  },
  subtitle: {
    color: palette.inkSoft,
    fontSize: 15,
    lineHeight: 24,
    maxWidth: 640,
    fontFamily: fontFamily.body,
  },
  primarySurface: {
    padding: 22,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.surface,
    gap: 22,
    ...panelShadow,
  },
  primaryMeta: {
    gap: 6,
  },
  sectionEyebrow: {
    color: palette.accentStrong,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.8,
    fontFamily: fontFamily.display,
  },
  roleTitle: {
    color: palette.ink,
    fontSize: 30,
    lineHeight: 36,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  roleTone: {
    color: palette.warm,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  timeline: {
    gap: 14,
  },
  timelineRow: {
    gap: 4,
    paddingTop: 14,
    borderTopWidth: 1,
    borderColor: palette.line,
  },
  timelineLabel: {
    color: palette.inkSoft,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: fontFamily.body,
  },
  timelineValue: {
    color: palette.ink,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  secondaryCluster: {
    gap: 16,
  },
  noteSurface: {
    padding: 18,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.white,
    gap: 6,
  },
  noteSurfaceLeft: {
    alignSelf: "stretch",
  },
  noteSurfaceRight: {
    alignSelf: "flex-end",
    width: "88%",
  },
  noteTitle: {
    color: palette.ink,
    fontSize: 18,
    lineHeight: 26,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  noteText: {
    color: palette.inkSoft,
    fontSize: 14,
    lineHeight: 22,
    fontFamily: fontFamily.body,
  },
});
