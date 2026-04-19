import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Redirect, Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { requestFreshAssistantChatFromTab } from "@/features/assistant/assistantFreshChatBus";
import { LoadingScreen, useAuth } from "@/features/auth";
import { GuardianEventWatcher } from "@/features/guardians";
import { fontFamily, palette, radius } from "@/shared/theme";

const hiddenTabBarStyle = { display: "none" as const };

export default function MainTabsLayout() {
  const insets = useSafeAreaInsets();
  const { status, user } = useAuth();

  if (status === "loading") {
    return <LoadingScreen label="正在恢复账号状态…" />;
  }

  if (status !== "authenticated" || !user) {
    return <Redirect href="/login" />;
  }

  return (
    <>
      <GuardianEventWatcher />
      <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: {
          backgroundColor: palette.background,
        },
        tabBarActiveTintColor: palette.accentStrong,
        tabBarInactiveTintColor: palette.inkSoft,
        tabBarHideOnKeyboard: true,
        tabBarStyle: {
          backgroundColor: palette.surface,
          borderTopWidth: 1,
          borderTopColor: palette.line,
          height: 62 + Math.max(insets.bottom, 10),
          paddingTop: 8,
          paddingBottom: Math.max(insets.bottom, 10),
          paddingHorizontal: 10,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          lineHeight: 14,
          fontWeight: "700",
          fontFamily: fontFamily.body,
        },
        tabBarItemStyle: {
          borderRadius: radius.md,
          marginHorizontal: 4,
        },
        tabBarActiveBackgroundColor: palette.accentSoft,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "首页",
          tabBarIcon: ({ color, focused }) => (
            <MaterialCommunityIcons
              name={focused ? "home-variant" : "home-variant-outline"}
              size={22}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="records"
        options={{
          title: "记录",
          tabBarIcon: ({ color }) => <MaterialCommunityIcons name="history" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="assistant/index"
        options={{
          title: "智能体",
          tabBarIcon: ({ color, focused }) => (
            <MaterialCommunityIcons
              name={focused ? "robot" : "robot-outline"}
              size={22}
              color={color}
            />
          ),
        }}
        listeners={({ navigation }) => ({
          tabPress: (e) => {
            if (navigation.isFocused()) {
              e.preventDefault();
              requestFreshAssistantChatFromTab();
            }
          },
        })}
      />
      <Tabs.Screen
        name="learning/index"
        options={{
          title: "学习中心",
          tabBarIcon: ({ color, focused }) => (
            <MaterialCommunityIcons
              name={focused ? "school" : "school-outline"}
              size={22}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "我的",
          tabBarIcon: ({ color, focused }) => (
            <MaterialCommunityIcons
              name={focused ? "account-circle" : "account-circle-outline"}
              size={22}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen name="settings/index" options={{ href: null, title: "权限设置", tabBarStyle: hiddenTabBarStyle }} />
      <Tabs.Screen name="call-intervention/index" options={{ href: null, title: "来电预警", tabBarStyle: hiddenTabBarStyle }} />
      <Tabs.Screen name="call-intervention/[sessionId]" options={{ href: null, title: "通话回看", tabBarStyle: hiddenTabBarStyle }} />
      <Tabs.Screen name="cases/index" options={{ href: null, title: "案例", tabBarStyle: hiddenTabBarStyle }} />
      <Tabs.Screen name="cases/[id]" options={{ href: null, title: "案例详情", tabBarStyle: hiddenTabBarStyle }} />
      <Tabs.Screen name="learning/quiz" options={{ href: null, title: "刷题", tabBarStyle: hiddenTabBarStyle }} />
      <Tabs.Screen name="learning/simulation" options={{ href: null, title: "模拟", tabBarStyle: hiddenTabBarStyle }} />
      <Tabs.Screen
        name="profile-memory/index"
        options={{ href: null, title: "用户画像", tabBarStyle: hiddenTabBarStyle }}
      />
      <Tabs.Screen
        name="records/analytics"
        options={{ href: null, title: "数据分析", tabBarStyle: hiddenTabBarStyle }}
      />
      <Tabs.Screen
        name="records/[id]"
        options={{ href: null, title: "检测详情", tabBarStyle: hiddenTabBarStyle }}
      />
      <Tabs.Screen
        name="uploads/index"
        options={{ href: null, title: "上传管理", tabBarStyle: hiddenTabBarStyle }}
      />
      <Tabs.Screen
        name="uploads/archive"
        options={{ href: null, title: "上传归档", tabBarStyle: hiddenTabBarStyle }}
      />
      <Tabs.Screen
        name="floating-capture/action"
        options={{
          href: null,
          title: "悬浮截图",
          tabBarStyle: { display: "none" },
        }}
      />
      <Tabs.Screen
        name="relations/index"
        options={{ href: null, title: "关系记忆", tabBarStyle: hiddenTabBarStyle }}
      />
      <Tabs.Screen
        name="relations/[id]"
        options={{ href: null, title: "关系详情", tabBarStyle: hiddenTabBarStyle }}
      />
      <Tabs.Screen
        name="guardians/index"
        options={{ href: null, title: "监护人", tabBarStyle: hiddenTabBarStyle }}
      />
      <Tabs.Screen
        name="guardians/events/[id]"
        options={{ href: null, title: "联动详情", tabBarStyle: hiddenTabBarStyle }}
      />
      <Tabs.Screen
        name="guardians/reports/index"
        options={{ href: null, title: "安全监测报告", tabBarStyle: hiddenTabBarStyle }}
      />
      <Tabs.Screen
        name="guardians/reports/[id]"
        options={{ href: null, title: "报告详情", tabBarStyle: hiddenTabBarStyle }}
      />
      <Tabs.Screen name="submit" options={{ href: null, title: "提交检测" }} />
      <Tabs.Screen
        name="detect-text"
        options={{ href: null, title: "文本检测", tabBarStyle: hiddenTabBarStyle }}
      />
      <Tabs.Screen name="detect-ocr" options={{ href: null, title: "OCR 话术识别", tabBarStyle: hiddenTabBarStyle }} />
      <Tabs.Screen
        name="detect-official-document"
        options={{ href: null, title: "公章仿造检测", tabBarStyle: hiddenTabBarStyle }}
      />
      <Tabs.Screen name="detect-pii" options={{ href: null, title: "敏感信息检测", tabBarStyle: hiddenTabBarStyle }} />
      <Tabs.Screen name="detect-qr" options={{ href: null, title: "二维码检测", tabBarStyle: hiddenTabBarStyle }} />
      <Tabs.Screen
        name="detect-impersonation"
        options={{ href: null, title: "网图识别", tabBarStyle: hiddenTabBarStyle }}
      />
      <Tabs.Screen name="detect-visual" options={{ href: null, title: "图片/视频检测", tabBarStyle: hiddenTabBarStyle }} />
      <Tabs.Screen name="detect-ai-face" options={{ href: null, title: "AI 换脸识别", tabBarStyle: hiddenTabBarStyle }} />
      <Tabs.Screen name="detect-audio" options={{ href: null, title: "音频检测", tabBarStyle: hiddenTabBarStyle }} />
      <Tabs.Screen name="detect-audio-verify" options={{ href: null, title: "AI语音识别", tabBarStyle: hiddenTabBarStyle }} />
      <Tabs.Screen name="detect-audio/select-uploaded" options={{ href: null, title: "已上传音频", tabBarStyle: hiddenTabBarStyle }} />
      <Tabs.Screen name="audio-deep-analysis" options={{ href: null, title: "语音深度分析", tabBarStyle: hiddenTabBarStyle }} />
      <Tabs.Screen name="audio-process-timeline" options={{ href: null, title: "过程演化", tabBarStyle: hiddenTabBarStyle }} />
      <Tabs.Screen name="audio-evidence-segments" options={{ href: null, title: "证据片段", tabBarStyle: hiddenTabBarStyle }} />
      <Tabs.Screen name="audio-insight/analysis" options={{ href: null, title: "语音深度分析", tabBarStyle: hiddenTabBarStyle }} />
      <Tabs.Screen name="audio-insight/timeline" options={{ href: null, title: "过程演化", tabBarStyle: hiddenTabBarStyle }} />
      <Tabs.Screen name="audio-insight/segments" options={{ href: null, title: "证据片段", tabBarStyle: hiddenTabBarStyle }} />
      <Tabs.Screen name="detect-mixed" options={{ href: null, title: "混合检测", tabBarStyle: hiddenTabBarStyle }} />
      <Tabs.Screen name="detect-web" options={{ href: null, title: "网站检测", tabBarStyle: hiddenTabBarStyle }} />
      </Tabs>
    </>
  );
}
