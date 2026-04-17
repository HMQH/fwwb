import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { authApi } from "@/features/auth";

import type { GuardianEvent } from "./types";

export type GuardianNotificationPreview = Pick<
  GuardianEvent,
  "id" | "risk_level" | "summary" | "ward_display_name"
> & {
  created_at?: string | null;
};

export type GuardianNotificationData = {
  type?: string;
  event_id?: string;
  risk_level?: string;
  summary?: string;
  ward_display_name?: string;
  created_at?: string;
};

export const GUARDIAN_NOTIFICATION_CHANNEL_ID = "guardian-risk-alerts";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: false,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

function getProjectId() {
  const easConfig = Constants.easConfig;
  if (easConfig?.projectId) {
    return easConfig.projectId;
  }
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? undefined;
}

function getDeviceName() {
  const deviceName = (Constants as typeof Constants & { deviceName?: string }).deviceName;
  return typeof deviceName === "string" && deviceName.trim() ? deviceName.trim() : null;
}

export function getGuardianEventIdFromData(input: unknown) {
  if (!input || typeof input !== "object") {
    return null;
  }
  const eventId = (input as { event_id?: unknown }).event_id;
  return typeof eventId === "string" && eventId.trim() ? eventId : null;
}

export function getGuardianPreviewFromData(input: unknown): GuardianNotificationPreview | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  const payload = input as GuardianNotificationData;
  if (payload.type && payload.type !== "guardian_risk_event") {
    return null;
  }
  if (!payload.event_id || !payload.summary) {
    return null;
  }
  return {
    id: payload.event_id,
    risk_level: payload.risk_level ?? "high",
    summary: payload.summary,
    ward_display_name: payload.ward_display_name ?? "被监护人",
    created_at: payload.created_at ?? null,
  };
}

export async function registerGuardianPushNotifications(token: string) {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(GUARDIAN_NOTIFICATION_CHANNEL_ID, {
      name: "监护风险提醒",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 220, 120, 260],
      lightColor: "#2F70E6",
      sound: "default",
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      bypassDnd: false,
    });
  }

  let status = (await Notifications.getPermissionsAsync()).status;
  if (status !== "granted") {
    status = (
      await Notifications.requestPermissionsAsync({
        ios: {
          allowAlert: true,
          allowBadge: true,
          allowSound: true,
        },
      })
    ).status;
  }

  if (status !== "granted") {
    return null;
  }

  const projectId = getProjectId();
  const pushTokenResponse = projectId
    ? await Notifications.getExpoPushTokenAsync({ projectId })
    : await Notifications.getExpoPushTokenAsync();

  const expoPushToken = pushTokenResponse.data;
  await authApi.registerPushToken(
    {
      expo_push_token: expoPushToken,
      platform:
        Platform.OS === "ios"
          ? "ios"
          : Platform.OS === "android"
            ? "android"
            : Platform.OS === "web"
              ? "web"
              : "unknown",
      device_name: getDeviceName(),
    },
    token
  );
  return expoPushToken;
}
