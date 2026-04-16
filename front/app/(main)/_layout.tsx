import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Redirect, Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

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
      <Tabs.Screen name="settings/index" options={{ href: null, title: "权限设置" }} />
      <Tabs.Screen name="call-intervention/index" options={{ href: null, title: "来电预警" }} />
      <Tabs.Screen name="call-intervention/[sessionId]" options={{ href: null, title: "通话回看" }} />
      <Tabs.Screen name="assistant/index" options={{ href: null, title: "反诈助手" }} />
      <Tabs.Screen
        name="profile-memory/index"
        options={{ href: null, title: "用户画像", tabBarStyle: hiddenTabBarStyle }}
      />
      <Tabs.Screen
        name="records/analytics"
        options={{ href: null, title: "数据分析", tabBarStyle: hiddenTabBarStyle }}
      />
      <Tabs.Screen name="records/[id]" options={{ href: null, title: "检测详情" }} />
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
      <Tabs.Screen name="submit" options={{ href: null, title: "提交检测" }} />
      <Tabs.Screen name="detect-text" options={{ href: null, title: "文本检测" }} />
      <Tabs.Screen name="detect-visual" options={{ href: null, title: "图片/视频检测" }} />
      <Tabs.Screen name="detect-ai-face" options={{ href: null, title: "AI 换脸识别" }} />
      <Tabs.Screen name="detect-audio" options={{ href: null, title: "音频检测" }} />
      <Tabs.Screen name="detect-mixed" options={{ href: null, title: "混合检测" }} />
      <Tabs.Screen name="detect-web" options={{ href: null, title: "网站检测" }} />
      </Tabs>
    </>
  );
}
