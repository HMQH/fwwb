import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useMemo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AuthBackdrop, useAuth } from "@/features/auth";
import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";

type RecordItem = {
  type: "文本检测" | "图片检测" | "语音检测" | "系统消息" | "风险消息";
  time: string;
  title: string;
  detail: string;
};

const recordMeta: Record<
  RecordItem["type"],
  {
    icon: keyof typeof MaterialCommunityIcons.glyphMap;
    tone: string;
    soft: string;
  }
> = {
  文本检测: {
    icon: "message-text-outline",
    tone: palette.accentStrong,
    soft: palette.accentSoft,
  },
  图片检测: {
    icon: "image-outline",
    tone: palette.accentStrong,
    soft: palette.accentSoft,
  },
  语音检测: {
    icon: "microphone-outline",
    tone: palette.accentStrong,
    soft: palette.accentSoft,
  },
  系统消息: {
    icon: "bell-outline",
    tone: palette.accentStrong,
    soft: palette.surfaceStrong,
  },
  风险消息: {
    icon: "shield-alert-outline",
    tone: palette.accentStrong,
    soft: palette.accentSoft,
  },
};

function buildRecords(role: "child" | "youth" | "elder"): RecordItem[] {
  if (role === "child") {
    return [
      {
        type: "风险消息",
        time: "今天 09:12",
        title: "异常链接提醒",
        detail: "近期出现以游戏道具交易为名的陌生链接，请先核验来源。",
      },
      {
        type: "文本检测",
        time: "昨天 20:18",
        title: "聊天内容识别完成",
        detail: "检测到“低价代充”“先转账后发货”等高频话术。",
      },
      {
        type: "系统消息",
        time: "昨天 16:40",
        title: "防护策略更新",
        detail: "未成年守护模式已加强扫码授权与账号共享场景提醒。",
      },
    ];
  }

  if (role === "elder") {
    return [
      {
        type: "风险消息",
        time: "今天 08:54",
        title: "转账核验提醒",
        detail: "涉及借钱、理财、保健品付款时，请优先联系家人确认。",
      },
      {
        type: "语音检测",
        time: "昨天 18:25",
        title: "语音内容识别完成",
        detail: "通话中出现索要验证码与银行卡信息的高风险指令。",
      },
      {
        type: "系统消息",
        time: "昨天 11:36",
        title: "长者防护策略更新",
        detail: "已强化冒充亲友与陌生来电场景的预警提示。",
      },
    ];
  }

  return [
    {
      type: "风险消息",
      time: "今天 10:08",
      title: "高频话术提醒",
      detail: "兼职返利、贷款解冻、征信修复等内容近期仍需优先警惕。",
    },
    {
      type: "图片检测",
      time: "昨天 21:30",
      title: "图片内容识别完成",
      detail: "截图中出现仿冒客服页面与异常收款二维码元素。",
    },
    {
      type: "系统消息",
      time: "昨天 15:02",
      title: "风险库同步完成",
      detail: "系统已更新远程协助与屏幕共享场景的识别规则。",
    },
  ];
}

export default function RecordsScreen() {
  const { user } = useAuth();

  const items = useMemo(() => {
    if (!user) {
      return [];
    }

    return buildRecords(user.role);
  }, [user]);

  return (
    <View style={styles.root}>
      <AuthBackdrop />
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.headerBlock}>
            <Text style={styles.pageTitle}>记录</Text>
            <Text style={styles.pageSubtitle}>历史识别记录与系统风险消息统一在这里查看</Text>
          </View>

          <View style={styles.summaryCard}>
            <Text style={styles.summaryTitle}>最近动态</Text>
            <Text style={styles.summaryText}>近 24 小时共整理 {items.length} 条记录，系统消息与风险提醒已合并展示。</Text>
          </View>

          <View style={styles.listCard}>
            {items.map((item, index) => {
              const meta = recordMeta[item.type];

              return (
                <View
                  key={`${item.type}-${item.time}-${item.title}`}
                  style={[styles.recordRow, index < items.length - 1 && styles.rowDivider]}
                >
                  <View style={[styles.recordIconWrap, { backgroundColor: meta.soft }]}>
                    <MaterialCommunityIcons name={meta.icon} size={20} color={meta.tone} />
                  </View>

                  <View style={styles.recordBody}>
                    <View style={styles.recordTop}>
                      <Text style={styles.recordTitle}>{item.title}</Text>
                      <Text style={styles.recordTime}>{item.time}</Text>
                    </View>

                    <View style={[styles.typePill, { backgroundColor: meta.soft }]}>
                      <Text style={[styles.typePillText, { color: meta.tone }]}>{item.type}</Text>
                    </View>

                    <Text style={styles.recordDetail}>{item.detail}</Text>
                  </View>
                </View>
              );
            })}
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
    gap: 16,
  },
  headerBlock: {
    gap: 4,
  },
  pageTitle: {
    color: palette.ink,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  pageSubtitle: {
    color: palette.inkSoft,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: fontFamily.body,
  },
  summaryCard: {
    borderRadius: radius.xl,
    paddingHorizontal: 18,
    paddingVertical: 18,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    gap: 6,
    ...panelShadow,
  },
  summaryTitle: {
    color: palette.ink,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  summaryText: {
    color: palette.inkSoft,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: fontFamily.body,
  },
  listCard: {
    borderRadius: radius.lg,
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
  rowDivider: {
    borderBottomWidth: 1,
    borderColor: palette.line,
  },
  recordIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
  },
  recordBody: {
    flex: 1,
    gap: 8,
  },
  recordTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  recordTitle: {
    flex: 1,
    color: palette.ink,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  recordTime: {
    color: palette.lineStrong,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  typePill: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  typePillText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  recordDetail: {
    color: palette.inkSoft,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: fontFamily.body,
  },
});
