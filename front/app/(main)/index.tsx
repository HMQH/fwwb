import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useMemo } from "react";
import { useRouter } from "expo-router";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { roleMeta, useAuth } from "@/features/auth";
import type { GuardianRelation, UserRole } from "@/features/auth";
import { resolveApiFileUrl } from "@/shared/api";
import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";

type DetectionMode = "text" | "visual" | "audio" | "mixed";
type RecordStatus = "safe" | "review" | "shielded";

type HomeRecord = {
  mode: DetectionMode;
  time: string;
  title: string;
  detail: string;
  status: RecordStatus;
};

const detectEntries: {
  mode: DetectionMode;
  title: string;
  subtitle: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
}[] = [
  {
    mode: "text",
    title: "文本检测",
    subtitle: "聊天、短信、链接",
    icon: "message-text-outline",
  },
  {
    mode: "visual",
    title: "图片/视频检测",
    subtitle: "截图、海报、收款码",
    icon: "image-search-outline",
  },
  {
    mode: "audio",
    title: "音频检测",
    subtitle: "通话录音、语音消息",
    icon: "microphone-outline",
  },
  {
    mode: "mixed",
    title: "混合检测",
    subtitle: "多材料联合判断",
    icon: "layers-triple-outline",
  },
];

const modeMeta: Record<
  DetectionMode,
  {
    label: string;
    icon: keyof typeof MaterialCommunityIcons.glyphMap;
    soft: string;
    tone: string;
  }
> = {
  text: {
    label: "文本",
    icon: "message-text-outline",
    soft: palette.accentSoft,
    tone: palette.accentStrong,
  },
  visual: {
    label: "图像",
    icon: "image-search-outline",
    soft: "#EEF4FF",
    tone: "#3B7BE9",
  },
  audio: {
    label: "音频",
    icon: "microphone-outline",
    soft: "#EAF2FF",
    tone: "#306EE0",
  },
  mixed: {
    label: "混合",
    icon: "layers-triple-outline",
    soft: palette.surfaceStrong,
    tone: palette.ink,
  },
};

const statusMeta: Record<
  RecordStatus,
  {
    label: string;
    soft: string;
    tone: string;
  }
> = {
  safe: {
    label: "无风险",
    soft: "#EEF5FF",
    tone: "#4C7FD7",
  },
  review: {
    label: "需复核",
    soft: "#E5F0FF",
    tone: palette.accentStrong,
  },
  shielded: {
    label: "已拦截",
    soft: "#DCEAFF",
    tone: palette.ink,
  },
};

function buildHomeRecords(role: UserRole): HomeRecord[] {
  if (role === "child") {
    return [
      {
        mode: "mixed",
        time: "2小时前",
        title: "聊天截图联合检测完成",
        detail: "未发现直接转账指令，已提示谨慎核验陌生群链接来源。",
        status: "safe",
      },
      {
        mode: "text",
        time: "昨天 19:40",
        title: "游戏代充话术识别",
        detail: "检测到先付款后发货的诱导语句，建议不要继续私下交易。",
        status: "review",
      },
      {
        mode: "visual",
        time: "昨天 14:18",
        title: "二维码页面风险拦截",
        detail: "截图中存在仿冒充值页元素，系统已标记为重点风险内容。",
        status: "shielded",
      },
    ];
  }

  if (role === "elder") {
    return [
      {
        mode: "audio",
        time: "2小时前",
        title: "来电录音检测完成",
        detail: "本次录音未识别到索要验证码或大额转账指令。",
        status: "safe",
      },
      {
        mode: "mixed",
        time: "昨天 17:24",
        title: "陌生人转账请求复核",
        detail: "内容涉及借款与紧急付款，建议先联系家人或熟人核验。",
        status: "review",
      },
      {
        mode: "text",
        time: "昨天 10:08",
        title: "保健投资话术扫描",
        detail: "发现高收益承诺表达，已加入重点关注案例库。",
        status: "review",
      },
    ];
  }

  return [
    {
      mode: "mixed",
      time: "2小时前",
      title: "聊天与截图联合检测完成",
      detail: "未发现异常收款或验证码索取行为，本次判断为低风险。",
      status: "safe",
    },
    {
      mode: "text",
      time: "昨天 21:16",
      title: "兼职返利内容复核",
      detail: "识别到返利和先垫付话术，建议不要离开平台进行私下沟通。",
      status: "review",
    },
    {
      mode: "audio",
      time: "昨天 15:32",
      title: "语音消息检测完成",
      detail: "录音中未出现转账口令，但建议继续留意陌生号码的重复来电。",
      status: "safe",
    },
  ];
}

function buildSafetyScore(
  role: UserRole,
  guardianRelation: GuardianRelation | null,
  records: HomeRecord[]
) {
  const baseScore = {
    child: 97,
    youth: 97,
    elder: 96,
  }[role];

  const penalty = records.reduce((sum, item) => {
    if (item.status === "review") {
      return sum + 2;
    }

    if (item.status === "shielded") {
      return sum + 4;
    }

    return sum;
  }, 0);

  const guardianBonus = guardianRelation && guardianRelation !== "self" ? 2 : 0;
  const score = Math.max(86, Math.min(99, baseScore + guardianBonus - penalty));
  const reviewCount = records.filter((item) => item.status !== "safe").length;

  return {
    score,
    reviewCount,
    weeklyDetections: role === "child" ? 16 : role === "elder" ? 14 : 18,
    title: score >= 96 ? "状态稳定" : score >= 92 ? "保持警觉" : "建议加强核验",
    summary:
      score >= 96
        ? "近期识别结果整体平稳，当前防护状态良好。"
        : score >= 92
          ? "近两天出现可疑话术，建议保持当前核验习惯。"
          : "近期可疑内容增加，建议优先使用混合检测进行复核。",
  };
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

  const recentRecords = useMemo(() => {
    if (!user) {
      return [];
    }

    return buildHomeRecords(user.role);
  }, [user]);

  const safetyOverview = useMemo(() => {
    if (!user) {
      return null;
    }

    return buildSafetyScore(user.role, user.guardian_relation, recentRecords);
  }, [recentRecords, user]);

  const avatarUri = useMemo(() => resolveApiFileUrl(user?.avatar_url), [user?.avatar_url]);

  if (!user || !currentRole || !safetyOverview) {
    return null;
  }

  const latestRecord = recentRecords[0];
  const latestStatus = statusMeta[latestRecord.status];

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.topBar}>
            <View style={styles.profileRow}>
              <View style={styles.avatarShell}>
                {avatarUri ? (
                  <Image source={{ uri: avatarUri }} style={styles.avatarImage} />
                ) : (
                  <Text style={styles.avatarInitial}>{user.display_name.slice(0, 1)}</Text>
                )}
              </View>

              <View style={styles.profileText}>
                <Text style={styles.profileHint}>首页</Text>
                <Text style={styles.profileName}>{user.display_name}</Text>
                <Text style={styles.profileRole}>{currentRole.label}</Text>
              </View>
            </View>

            <Pressable
              style={({ pressed }) => [styles.noticeButton, pressed && styles.noticeButtonPressed]}
              onPress={() => router.push("/records")}
            >
              <MaterialCommunityIcons name="bell-outline" size={22} color={palette.accentStrong} />
              <View style={styles.noticeDot} />
            </Pressable>
          </View>

          <View style={styles.securityCard}>
            <View style={styles.securityHeader}>
              <View style={styles.securityHeaderCopy}>
                <Text style={styles.securityEyebrow}>安全概览</Text>
                <Text style={styles.securityHeaderTitle}>检测分数</Text>
              </View>

              <View style={styles.securityTag}>
                <Text style={styles.securityTagText}>{safetyOverview.title}</Text>
              </View>
            </View>

            <View style={styles.securityPanel}>
              <View style={styles.securityCopy}>
                <Text style={styles.metricLabel}>您的安全评分</Text>
                <Text style={styles.metricValue}>
                  {safetyOverview.score}
                  <Text style={styles.metricUnit}>分</Text>
                </Text>
                <Text style={styles.metricHeadline}>{safetyOverview.summary}</Text>
                <Text style={styles.metricDetail}>
                  最近一次检测：{latestRecord.time} / {latestStatus.label}
                </Text>
              </View>

              <View style={styles.gaugeWrap}>
                <View style={styles.gaugeTrack} />
                <View style={styles.gaugeArcPrimary} />
                <View style={styles.gaugeArcSecondary} />
                <View style={styles.gaugeCore}>
                  <Text style={styles.gaugeLabel}>安全值</Text>
                  <Text style={styles.gaugeScore}>{safetyOverview.score}</Text>
                  <Text style={styles.gaugeHint}>近7天更新</Text>
                </View>
              </View>
            </View>

            <View style={styles.securityFooter}>
              <View style={styles.footerItem}>
                <Text style={styles.footerLabel}>本周检测</Text>
                <Text style={styles.footerValue}>{safetyOverview.weeklyDetections}次</Text>
              </View>
              <View style={styles.footerDivider} />
              <View style={styles.footerItem}>
                <Text style={styles.footerLabel}>重点提醒</Text>
                <Text style={styles.footerValue}>{safetyOverview.reviewCount}条</Text>
              </View>
            </View>
          </View>

          <View style={styles.sectionBlock}>
            <Text style={styles.sectionTitle}>四大检测入口</Text>
            <View style={styles.entryGrid}>
              {detectEntries.map((item) => (
                <Pressable
                  key={item.mode}
                  style={({ pressed }) => [styles.entryCard, pressed && styles.entryCardPressed]}
                  onPress={() => router.push("/submit")}
                >
                  <View style={styles.entryIconWrap}>
                    <MaterialCommunityIcons
                      name={item.icon}
                      size={21}
                      color={palette.accentStrong}
                    />
                  </View>
                  <Text style={styles.entryTitle}>{item.title}</Text>
                  <Text style={styles.entrySubtitle}>{item.subtitle}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={styles.sectionBlock}>
            <View style={styles.sectionHeadRow}>
              <Text style={styles.sectionTitle}>最近检测记录</Text>
              <Pressable
                style={({ pressed }) => [styles.linkButton, pressed && styles.linkButtonPressed]}
                onPress={() => router.push("/records")}
              >
                <Text style={styles.linkButtonText}>查看全部历史</Text>
                <MaterialCommunityIcons
                  name="chevron-right"
                  size={16}
                  color={palette.accentStrong}
                />
              </Pressable>
            </View>

            <View style={styles.recordsCard}>
              {recentRecords.slice(0, 3).map((item, index) => {
                const currentMode = modeMeta[item.mode];
                const currentStatus = statusMeta[item.status];

                return (
                  <View
                    key={`${item.mode}-${item.time}-${item.title}`}
                    style={[styles.recordRow, index < 2 && styles.recordDivider]}
                  >
                    <View style={[styles.recordIconWrap, { backgroundColor: currentMode.soft }]}>
                      <MaterialCommunityIcons
                        name={currentMode.icon}
                        size={20}
                        color={currentMode.tone}
                      />
                    </View>

                    <View style={styles.recordBody}>
                      <View style={styles.recordTop}>
                        <Text style={styles.recordTitle} numberOfLines={1}>
                          {item.title}
                        </Text>
                        <Text style={styles.recordTime}>{item.time}</Text>
                      </View>

                      <Text style={styles.recordDetail} numberOfLines={2}>
                        {item.detail}
                      </Text>

                      <View style={styles.recordMetaRow}>
                        <View style={[styles.metaPill, { backgroundColor: currentMode.soft }]}>
                          <Text style={[styles.metaPillText, { color: currentMode.tone }]}>
                            {currentMode.label}
                          </Text>
                        </View>

                        <View style={[styles.metaPill, { backgroundColor: currentStatus.soft }]}>
                          <Text style={[styles.metaPillText, { color: currentStatus.tone }]}>
                            {currentStatus.label}
                          </Text>
                        </View>
                      </View>
                    </View>
                  </View>
                );
              })}
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
    paddingTop: 10,
    paddingBottom: 28,
    gap: 20,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  profileRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  avatarShell: {
    width: 52,
    height: 52,
    borderRadius: 18,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarImage: {
    width: "100%",
    height: "100%",
  },
  avatarInitial: {
    color: palette.accentStrong,
    fontSize: 20,
    lineHeight: 24,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  profileText: {
    flex: 1,
    gap: 2,
  },
  profileHint: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fontFamily.body,
  },
  profileName: {
    color: palette.ink,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  profileRole: {
    color: palette.accentStrong,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  noticeButton: {
    width: 48,
    height: 48,
    borderRadius: 18,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    alignItems: "center",
    justifyContent: "center",
  },
  noticeButtonPressed: {
    opacity: 0.9,
  },
  noticeDot: {
    position: "absolute",
    top: 12,
    right: 12,
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: palette.accentStrong,
  },
  securityCard: {
    borderRadius: 30,
    backgroundColor: palette.accentStrong,
    padding: 16,
    gap: 14,
    ...panelShadow,
  },
  securityHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  securityHeaderCopy: {
    gap: 2,
  },
  securityEyebrow: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "600",
    fontFamily: fontFamily.body,
  },
  securityHeaderTitle: {
    color: palette.inkInverse,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  securityTag: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: "rgba(255,255,255,0.16)",
  },
  securityTagText: {
    color: palette.inkInverse,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  securityPanel: {
    borderRadius: 24,
    backgroundColor: palette.surface,
    paddingHorizontal: 16,
    paddingVertical: 18,
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
  },
  securityCopy: {
    flex: 1,
    gap: 6,
  },
  metricLabel: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fontFamily.body,
  },
  metricValue: {
    color: palette.ink,
    fontSize: 34,
    lineHeight: 38,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  metricUnit: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "700",
    color: palette.inkSoft,
    fontFamily: fontFamily.body,
  },
  metricHeadline: {
    color: palette.ink,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  metricDetail: {
    color: palette.inkSoft,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: fontFamily.body,
  },
  gaugeWrap: {
    width: 126,
    height: 126,
    alignItems: "center",
    justifyContent: "center",
  },
  gaugeTrack: {
    position: "absolute",
    width: 118,
    height: 118,
    borderRadius: 999,
    borderWidth: 10,
    borderColor: "#E7F0FD",
  },
  gaugeArcPrimary: {
    position: "absolute",
    width: 118,
    height: 118,
    borderRadius: 999,
    borderWidth: 10,
    borderColor: "transparent",
    borderTopColor: "#86B7FF",
    borderRightColor: "#4B8DF8",
    transform: [{ rotate: "-28deg" }],
  },
  gaugeArcSecondary: {
    position: "absolute",
    width: 96,
    height: 96,
    borderRadius: 999,
    borderWidth: 8,
    borderColor: "transparent",
    borderTopColor: "#C0DAFF",
    borderRightColor: "#7AA7F7",
    transform: [{ rotate: "34deg" }],
  },
  gaugeCore: {
    width: 74,
    height: 74,
    borderRadius: 999,
    backgroundColor: "#F8FBFF",
    borderWidth: 1,
    borderColor: "#DFEAFB",
    alignItems: "center",
    justifyContent: "center",
    gap: 1,
  },
  gaugeLabel: {
    color: palette.inkSoft,
    fontSize: 11,
    lineHeight: 14,
    fontFamily: fontFamily.body,
  },
  gaugeScore: {
    color: palette.accentStrong,
    fontSize: 28,
    lineHeight: 30,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  gaugeHint: {
    color: palette.inkSoft,
    fontSize: 10,
    lineHeight: 12,
    fontFamily: fontFamily.body,
  },
  securityFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.1)",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  footerItem: {
    flex: 1,
    gap: 4,
  },
  footerDivider: {
    width: 1,
    alignSelf: "stretch",
    backgroundColor: "rgba(255,255,255,0.18)",
    marginHorizontal: 12,
  },
  footerLabel: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 11,
    lineHeight: 15,
    fontFamily: fontFamily.body,
  },
  footerValue: {
    color: palette.inkInverse,
    fontSize: 17,
    lineHeight: 21,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  sectionBlock: {
    gap: 12,
  },
  sectionHeadRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  sectionTitle: {
    color: palette.ink,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  entryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  entryCard: {
    width: "48%",
    minHeight: 132,
    borderRadius: 24,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 14,
    paddingVertical: 16,
    gap: 10,
    ...panelShadow,
  },
  entryCardPressed: {
    opacity: 0.92,
    transform: [{ scale: 0.99 }],
  },
  entryIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 15,
    backgroundColor: palette.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  entryTitle: {
    color: palette.ink,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  entrySubtitle: {
    color: palette.inkSoft,
    fontSize: 13,
    lineHeight: 19,
    fontFamily: fontFamily.body,
  },
  linkButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  linkButtonPressed: {
    opacity: 0.86,
  },
  linkButtonText: {
    color: palette.accentStrong,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  recordsCard: {
    borderRadius: 24,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    overflow: "hidden",
    ...panelShadow,
  },
  recordRow: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  recordDivider: {
    borderBottomWidth: 1,
    borderColor: palette.line,
  },
  recordIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  recordBody: {
    flex: 1,
    gap: 8,
  },
  recordTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  recordTitle: {
    flex: 1,
    color: palette.ink,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  recordTime: {
    color: palette.inkSoft,
    fontSize: 11,
    lineHeight: 16,
    fontFamily: fontFamily.body,
  },
  recordDetail: {
    color: palette.inkSoft,
    fontSize: 13,
    lineHeight: 19,
    fontFamily: fontFamily.body,
  },
  recordMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  metaPill: {
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  metaPillText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
});
