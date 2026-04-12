import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Redirect } from "expo-router";
import { useMemo, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AuthBackdrop, LoadingScreen, roleMeta, useAuth } from "@/features/auth";
import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";

const antiFraudLogo = require("../../assets/images/anti-fraud-logo.png");

type ActionCard = {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  title: string;
  detail: string;
};

const actions: ActionCard[] = [
  {
    icon: "message-text-outline",
    title: "文本检测",
    detail: "甄别聊天与短信内容",
  },
  {
    icon: "image-outline",
    title: "图片检测",
    detail: "核验截图与二维码页面",
  },
  {
    icon: "microphone-outline",
    title: "语音检测",
    detail: "识别可疑语音诱导",
  },
];

function maskPhone(phone: string) {
  if (phone.length !== 11) {
    return phone;
  }

  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}

function getWarnings(role: "child" | "youth" | "elder") {
  if (role === "child") {
    return [
      "游戏交易和低价代充链接要先核验来源。",
      "任何要求共享验证码或扫码授权的请求都先暂停。",
    ];
  }

  if (role === "elder") {
    return [
      "涉及转账、保健投资、紧急借钱时先联系家人确认。",
      "陌生来电索要验证码、银行卡信息时立即停止操作。",
    ];
  }

  return [
    "兼职返利、贷款解冻、征信修复等话术要优先警惕。",
    "验证码、屏幕共享、远程协助请求都应先暂停核验。",
  ];
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

  const warnings = useMemo(() => {
    if (!user) {
      return [];
    }

    return getWarnings(user.role);
  }, [user]);

  if (status === "loading") {
    return <LoadingScreen label="正在恢复账户状态…" />;
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

  const accountRows = [
    { label: "手机号", value: maskPhone(user.phone) },
    { label: "生日", value: user.birth_date },
    { label: "守护模式", value: currentRole.label },
  ];

  return (
    <View style={styles.root}>
      <AuthBackdrop />
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.topBar}>
            <View style={styles.brandBlock}>
              <View style={styles.brandLogoWrap}>
                <Image source={antiFraudLogo} style={styles.brandLogo} resizeMode="contain" />
              </View>
              <View style={styles.brandTextBlock}>
                <Text style={styles.brandName}>反诈守护</Text>
                <Text style={styles.brandCaption}>实时风险提醒已开启</Text>
              </View>
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
              <Text style={styles.exitButtonText}>{signingOut ? "退出中…" : "退出"}</Text>
            </Pressable>
          </View>

          <View style={styles.heroCard}>
            <Text style={styles.heroGreeting}>你好，{user.display_name}</Text>
            <Text style={styles.heroRole}>{currentRole.label}</Text>
            <Text style={styles.heroTone}>{currentRole.tone}</Text>
            <Text style={styles.heroDetail}>{currentRole.detail}</Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>快速功能</Text>
            <View style={styles.groupCard}>
              {actions.map((item, index) => (
                <View key={item.title} style={[styles.row, index < actions.length - 1 && styles.rowDivider]}>
                  <View style={styles.rowIconWrap}>
                    <MaterialCommunityIcons name={item.icon} size={20} color={palette.accentStrong} />
                  </View>
                  <View style={styles.rowBody}>
                    <Text style={styles.rowTitle}>{item.title}</Text>
                    <Text style={styles.rowDetail}>{item.detail}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>账户信息</Text>
            <View style={styles.groupCard}>
              {accountRows.map((item, index) => (
                <View key={item.label} style={[styles.accountRow, index < accountRows.length - 1 && styles.rowDivider]}>
                  <Text style={styles.accountLabel}>{item.label}</Text>
                  <Text style={styles.accountValue}>{item.value}</Text>
                </View>
              ))}
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>重点提醒</Text>
            <View style={styles.groupCard}>
              {warnings.map((item, index) => (
                <View key={item} style={[styles.warningRow, index < warnings.length - 1 && styles.rowDivider]}>
                  <View style={styles.warningDot} />
                  <Text style={styles.warningText}>{item}</Text>
                </View>
              ))}
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
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 28,
    gap: 18,
  },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  brandBlock: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  brandLogoWrap: {
    width: 46,
    height: 46,
    borderRadius: 23,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
  },
  brandLogo: {
    width: 28,
    height: 28,
  },
  brandTextBlock: {
    gap: 2,
  },
  brandName: {
    color: palette.ink,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  brandCaption: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  exitButton: {
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 9,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
  },
  exitButtonText: {
    color: palette.accentStrong,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  buttonPressed: {
    opacity: 0.82,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  heroCard: {
    borderRadius: radius.xl,
    padding: 20,
    backgroundColor: palette.accent,
    gap: 6,
    ...panelShadow,
  },
  heroGreeting: {
    color: palette.inkInverse,
    fontSize: 26,
    lineHeight: 32,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  heroRole: {
    color: palette.inkInverse,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  heroTone: {
    color: "rgba(255,255,255,0.92)",
    fontSize: 14,
    lineHeight: 20,
    fontFamily: fontFamily.body,
  },
  heroDetail: {
    color: "rgba(255,255,255,0.84)",
    fontSize: 13,
    lineHeight: 20,
    fontFamily: fontFamily.body,
  },
  section: {
    gap: 10,
  },
  sectionTitle: {
    color: palette.ink,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  groupCard: {
    borderRadius: radius.lg,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    overflow: "hidden",
    ...panelShadow,
  },
  row: {
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
  rowIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: palette.accentSoft,
  },
  rowBody: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    color: palette.ink,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  rowDetail: {
    color: palette.inkSoft,
    fontSize: 13,
    lineHeight: 19,
    fontFamily: fontFamily.body,
  },
  accountRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  accountLabel: {
    color: palette.inkSoft,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  accountValue: {
    color: palette.ink,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  warningRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  warningDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: palette.accent,
    marginTop: 6,
  },
  warningText: {
    flex: 1,
    color: palette.inkSoft,
    fontSize: 14,
    lineHeight: 21,
    fontFamily: fontFamily.body,
  },
});
