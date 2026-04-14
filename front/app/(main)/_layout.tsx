import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Redirect, Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { LoadingScreen, useAuth } from "@/features/auth";
import { fontFamily, palette, radius } from "@/shared/theme";

export default function MainTabsLayout() {
  const insets = useSafeAreaInsets();
  const { status, user } = useAuth();

  if (status === "loading") {
    return <LoadingScreen label="正在恢复账户状态…" />;
  }

  if (status !== "authenticated" || !user) {
    return <Redirect href="/login" />;
  }

  return (
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
          tabBarIcon: ({ color }) => (
            <MaterialCommunityIcons name="history" size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen name="records/[id]" options={{ href: null, title: "检测详情" }} />
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
      <Tabs.Screen name="detect-audio" options={{ href: null, title: "音频检测" }} />
      <Tabs.Screen name="detect-mixed" options={{ href: null, title: "混合检测" }} />
    </Tabs>
  );
}
