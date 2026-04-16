import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { AuthProvider } from "@/features/auth";
import { CallInterventionProvider } from "@/features/call-intervention";
import { palette } from "@/shared/theme";

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <CallInterventionProvider>
          <StatusBar style="dark" />
          <Stack
            screenOptions={{
              headerShown: false,
              animation: "fade_from_bottom",
              contentStyle: { backgroundColor: palette.background },
            }}
          />
        </CallInterventionProvider>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}
