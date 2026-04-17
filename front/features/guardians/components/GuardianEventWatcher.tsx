import * as Haptics from "expo-haptics";
import * as Notifications from "expo-notifications";
import { usePathname, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import { useAuth } from "@/features/auth";

import { guardiansApi } from "../api";
import {
  getGuardianEventIdFromData,
  getGuardianPreviewFromData,
  registerGuardianPushNotifications,
  type GuardianNotificationPreview,
} from "../notification-service";
import type { GuardianEvent } from "../types";
import GuardianRiskPrompt from "./GuardianRiskPrompt";

function isGuardianEventDetailPath(pathname: string) {
  return pathname.startsWith("/guardians/events/");
}

function toPromptEvent(item: GuardianEvent): GuardianNotificationPreview {
  return {
    id: item.id,
    risk_level: item.risk_level,
    summary: item.summary,
    ward_display_name: item.ward_display_name,
    created_at: item.created_at,
  };
}

export default function GuardianEventWatcher() {
  const router = useRouter();
  const pathname = usePathname();
  const { token, status } = useAuth();

  const shownEventIdsRef = useRef<Set<string>>(new Set());
  const promptQueueRef = useRef<GuardianNotificationPreview[]>([]);
  const activePromptRef = useRef<GuardianNotificationPreview | null>(null);
  const pathnameRef = useRef(pathname);
  const lastHandledResponseIdRef = useRef<string | null>(null);

  const [activePrompt, setActivePrompt] = useState<GuardianNotificationPreview | null>(null);

  const setPrompt = useCallback((next: GuardianNotificationPreview | null) => {
    activePromptRef.current = next;
    setActivePrompt(next);
  }, []);

  const openEventDetail = useCallback(
    (eventId: string) => {
      if (pathnameRef.current === `/guardians/events/${eventId}`) {
        return;
      }
      router.push({
        pathname: "/guardians/events/[id]" as never,
        params: { id: eventId } as never,
      });
    },
    [router]
  );

  const showNextPrompt = useCallback(async () => {
    if (activePromptRef.current || isGuardianEventDetailPath(pathnameRef.current)) {
      return;
    }
    const next = promptQueueRef.current.shift();
    if (!next) {
      return;
    }
    setPrompt(next);
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
  }, [setPrompt]);

  const enqueuePrompt = useCallback(
    (next: GuardianNotificationPreview | null) => {
      if (!next || shownEventIdsRef.current.has(next.id)) {
        return;
      }
      shownEventIdsRef.current.add(next.id);
      promptQueueRef.current.push(next);
      void showNextPrompt();
    },
    [showNextPrompt]
  );

  const dismissPrompt = useCallback(() => {
    setPrompt(null);
    setTimeout(() => {
      void showNextPrompt();
    }, 0);
  }, [setPrompt, showNextPrompt]);

  const viewPrompt = useCallback(() => {
    const eventId = activePromptRef.current?.id;
    setPrompt(null);
    if (eventId) {
      openEventDetail(eventId);
    }
    setTimeout(() => {
      void showNextPrompt();
    }, 0);
  }, [openEventDetail, setPrompt, showNextPrompt]);

  useEffect(() => {
    pathnameRef.current = pathname;
    if (!isGuardianEventDetailPath(pathname)) {
      void showNextPrompt();
    }
  }, [pathname, showNextPrompt]);

  useEffect(() => {
    if (status !== "authenticated" || !token) {
      shownEventIdsRef.current.clear();
      promptQueueRef.current = [];
      setPrompt(null);
      return;
    }

    void registerGuardianPushNotifications(token).catch(() => undefined);
  }, [setPrompt, status, token]);

  useEffect(() => {
    if (status !== "authenticated" || !token) {
      return;
    }

    let disposed = false;

    const checkEvents = async () => {
      if (disposed) {
        return;
      }
      try {
        const events = await guardiansApi.listEvents(token, 8);
        events
          .filter((item) => item.ownership === "guardian" && item.notify_status === "sent")
          .forEach((item) => {
            enqueuePrompt(toPromptEvent(item));
          });
      } catch {
        // ignore polling failure
      }
    };

    void checkEvents();
    const timer = setInterval(() => {
      void checkEvents();
    }, 15000);
    const appStateSub = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        void checkEvents();
      }
    });

    return () => {
      disposed = true;
      clearInterval(timer);
      appStateSub.remove();
    };
  }, [enqueuePrompt, status, token]);

  useEffect(() => {
    if (status !== "authenticated" || !token) {
      return;
    }

    const receivedSub = Notifications.addNotificationReceivedListener((notification) => {
      enqueuePrompt(getGuardianPreviewFromData(notification.request.content.data));
    });

    const responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
      const responseId = response.notification.request.identifier;
      if (lastHandledResponseIdRef.current === responseId) {
        return;
      }
      lastHandledResponseIdRef.current = responseId;
      const eventId = getGuardianEventIdFromData(response.notification.request.content.data);
      if (!eventId) {
        return;
      }
      shownEventIdsRef.current.add(eventId);
      if (activePromptRef.current?.id === eventId) {
        setPrompt(null);
      }
      openEventDetail(eventId);
    });

    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) {
        return;
      }
      const responseId = response.notification.request.identifier;
      if (lastHandledResponseIdRef.current === responseId) {
        return;
      }
      lastHandledResponseIdRef.current = responseId;
      const eventId = getGuardianEventIdFromData(response.notification.request.content.data);
      if (!eventId) {
        return;
      }
      shownEventIdsRef.current.add(eventId);
      openEventDetail(eventId);
    });

    return () => {
      receivedSub.remove();
      responseSub.remove();
    };
  }, [enqueuePrompt, openEventDetail, setPrompt, status, token]);

  return (
    <GuardianRiskPrompt
      visible={Boolean(activePrompt)}
      event={activePrompt}
      onDismiss={dismissPrompt}
      onView={viewPrompt}
    />
  );
}
