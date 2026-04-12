import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useMemo } from "react";
import { useRouter } from "expo-router";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AuthBackdrop, roleMeta, useAuth } from "@/features/auth";
import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";

const antiFraudLogo = require("../../assets/images/anti-fraud-logo.png");

function getRecentSummary(role: "child" | "youth" | "elder") {
  if (role === "child") {
    return [
      {
        title: "游戏交易提醒",
        detail: "近期应重点关注低价代充、皮肤交易与陌生群聊链接。",
      },
      {
        title: "扫码授权提醒",
        detail: "遇到索要验证码或要求扫码登录时，先暂停并核验来源。",
      },
    ];
  }

  if (role === "elder") {
    return [
      {
        title: "转账核验提醒",
        detail: "凡是涉及借钱、理财或保健产品付款，建议先联系家人确认。",
      },
      {
        title: "陌生来电提醒",
        detail: "对方索要验证码、银行卡信息时，立即停止操作。",
      },
    ];
  }

  return [
    {
      title: "高频风险摘要",
      detail: "兼职返利、贷款解冻、征信修复等话术近期仍是主要风险来源。",
    },
    {
      title: "操作核验摘要",
      detail: "验证码、屏幕共享、远程协助请求出现时应优先暂停处理。",
    },
  ];
}

export default function HomeScreen() {
  const router = useRouter();
  const { user } = useAuth();

  const currentRole = useMemo(() => {
    if (!user) {
      return null;
    }

    return roleMeta[user.role];
  }, [user]);

  const recentSummary = useMemo(() => {
    if (!user) {
      return [];
    }

    return getRecentSummary(user.role);
  }, [user]);

  if (!user || !currentRole) {
    return null;
  }

  return (
    <View style={styles.root}>
      <AuthBackdrop />
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.topBar}>
            <View style={styles.brandBlock}>
              <View style={styles.brandLogoWrap}>
                <Image source={antiFraudLogo} style={styles.brandLogo} resizeMode="contain" />
              </View>
              <View style={styles.brandTextBlock}>
                <Text style={styles.brandName}>反诈守护</Text>
                <Text style={styles.brandCaption}>首页</Text>
              </View>
            </View>

            <View style={styles.livePill}>
              <View style={styles.liveDot} />
              <Text style={styles.livePillText}>实时防护中</Text>
            </View>
          </View>

          <View style={styles.heroCard}>
            <Text style={styles.heroGreeting}>你好，{user.display_name}</Text>
            <Text style={styles.heroRole}>{currentRole.label}</Text>
            <Text style={styles.heroDetail}>{currentRole.tone}</Text>
          </View>

          <Pressable
            style={({ pressed }) => [styles.entryCard, pressed && styles.entryCardPressed]}
            onPress={() => router.push("/submit")}
          >
            <View style={styles.entryIconWrap}>
              <MaterialCommunityIcons
                name="layers-triple-outline"
                size={22}
                color={palette.accentStrong}
              />
            </View>
            <View style={styles.entryBody}>
              <Text style={styles.entryTitle}>多模态检测提交</Text>
              <Text style={styles.entryDetail}>
                文字（聊天、短信、转账话术）、图片（截图、海报、二维码页面）、语音与视频可一并填写或上传，一次提交至服务端。
              </Text>
              <Text style={styles.entryBrief}>与单次检测接口一致，至少提供一种有效内容即可</Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={20} color={palette.lineStrong} />
          </Pressable>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>最近摘要</Text>
            <View style={styles.groupCard}>
              {recentSummary.map((item, index) => (
                <View
                  key={item.title}
                  style={[styles.summaryRow, index < recentSummary.length - 1 && styles.rowDivider]}
                >
                  <View style={styles.summaryDot} />
                  <View style={styles.summaryBody}>
                    <Text style={styles.summaryTitle}>{item.title}</Text>
                    <Text style={styles.summaryDetail}>{item.detail}</Text>
                  </View>
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
    paddingBottom: 24,
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
  livePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: palette.accent,
  },
  livePillText: {
    color: palette.accentStrong,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    fontFamily: fontFamily.body,
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
  heroDetail: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 14,
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
  entryCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderRadius: radius.lg,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    ...panelShadow,
  },
  entryCardPressed: {
    opacity: 0.92,
  },
  entryIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: palette.accentSoft,
  },
  entryBody: {
    flex: 1,
    gap: 2,
  },
  entryTitle: {
    color: palette.ink,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  entryDetail: {
    color: palette.inkSoft,
    fontSize: 13,
    lineHeight: 19,
    fontFamily: fontFamily.body,
  },
  entryBrief: {
    color: palette.lineStrong,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  groupCard: {
    borderRadius: radius.lg,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    overflow: "hidden",
    ...panelShadow,
  },
  summaryRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  rowDivider: {
    borderBottomWidth: 1,
    borderColor: palette.line,
  },
  summaryDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: palette.accent,
    marginTop: 6,
  },
  summaryBody: {
    flex: 1,
    gap: 3,
  },
  summaryTitle: {
    color: palette.ink,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  summaryDetail: {
    color: palette.inkSoft,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: fontFamily.body,
  },
});
