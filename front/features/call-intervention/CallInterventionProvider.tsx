import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Alert, AppState, PermissionsAndroid, Platform } from "react-native";

import { useAuth } from "@/features/auth";
import { ApiError, API_BASE } from "@/shared/api";

import { callInterventionApi, resolveCallInterventionWsBase } from "./api";
import { CallPermissionGuideModal } from "./components/CallPermissionGuideModal";
import { RiskWarningModal } from "./components/RiskWarningModal";
import { getCallPermissionGuideSeen, setCallPermissionGuideSeen } from "./guide-storage";
import { fraudInterventionModule, fraudInterventionNativeLoaded } from "./native/FraudInterventionModule";
import type {
  AudioChunkEvent,
  CallSession,
  IncomingRiskEvent,
  NativeDetectionStatus,
  NativeRiskWarningEvent,
  RecordingStatus,
  RiskEvent,
  RiskLevel,
  TranscriptSegment,
  WsMessage,
} from "./types";

type ManualRecordingOptions = {
  phoneNumber?: string | null;
  callDirection?: "incoming" | "outgoing";
};

type SessionSeed = {
  phoneNumber: string;
  riskLevel: RiskLevel;
  riskLabels: string[];
  callDirection: "incoming" | "outgoing";
};

type CallInterventionContextValue = {
  incomingRisk: IncomingRiskEvent | null;
  recording: RecordingStatus;
  transcriptSegments: TranscriptSegment[];
  liveTranscriptPreview: string;
  liveRiskEvents: RiskEvent[];
  sessionHistory: CallSession[];
  activeSession: CallSession | null;
  isBusy: boolean;
  nativeDetectionStatus: NativeDetectionStatus;
  refreshHistory: () => Promise<void>;
  refreshNativeDetectionStatus: () => Promise<NativeDetectionStatus>;
  prepareIncomingCallDetection: () => Promise<void>;
  requestRuntimeDetectionPermissions: () => Promise<void>;
  requestCallScreeningRole: () => Promise<void>;
  requestRecordingPermission: () => Promise<boolean>;
  openOverlayPermissionSettings: () => Promise<void>;
  startManualRecording: (options?: ManualRecordingOptions) => Promise<void>;
  stopManualRecording: () => Promise<void>;
  dismissIncomingRisk: () => void;
  dismissWarning: () => void;
  openPermissionGuide: () => void;
  resetDashboardState: () => void;
  nativeAvailable: boolean;
};

const CallInterventionContext = createContext<CallInterventionContextValue | null>(null);

function defaultRecording(): RecordingStatus {
  return {
    status: "idle",
    callId: null,
    phoneNumber: null,
    riskLevel: "low",
    isRecording: false,
    finalFilePath: null,
    segmentCount: 0,
    durationMs: 0,
    captureMode: null,
    captureSource: null,
    captureHint: "请先开启免提并调高通话音量。",
    speakerphoneRequired: true,
    reason: null,
  };
}

function defaultNativeDetectionStatus(nativeAvailable: boolean): NativeDetectionStatus {
  return {
    callScreeningEnabled: false,
    canRequestCallScreeningRole: nativeAvailable,
    phoneStatePermissionGranted: false,
    contactsPermissionGranted: false,
    overlayPermissionGranted: false,
    recordAudioPermissionGranted: false,
    notificationPermissionGranted: Platform.OS !== "android" || Platform.Version < 33,
  };
}

function normalizeIncomingRisk(payload: Partial<IncomingRiskEvent> | null | undefined): IncomingRiskEvent | null {
  if (!payload?.callId || !payload.phoneNumber) {
    return null;
  }

  return {
    callId: payload.callId,
    phoneNumber: payload.phoneNumber,
    riskLevel: (payload.riskLevel as RiskLevel) ?? "low",
    labels: payload.labels ?? [],
    message: payload.message ?? "检测到异常来电，建议谨慎接听",
    suggestedAction: payload.suggestedAction ?? "manual_recording",
  };
}

function normalizeRecording(payload: Partial<RecordingStatus> | null | undefined): RecordingStatus {
  return {
    ...defaultRecording(),
    ...(payload ?? {}),
    riskLevel: (payload?.riskLevel as RiskLevel) ?? "low",
    status: (payload?.status as RecordingStatus["status"]) ?? "idle",
    callId: payload?.callId ?? null,
    phoneNumber: payload?.phoneNumber ?? null,
    finalFilePath: payload?.finalFilePath ?? null,
    isRecording: Boolean(payload?.isRecording),
    segmentCount: Number(payload?.segmentCount ?? 0),
    durationMs: Number(payload?.durationMs ?? 0),
    captureMode: payload?.captureMode ?? null,
    captureSource: payload?.captureSource ?? null,
    captureHint: payload?.captureHint ?? "请先开启免提并调高通话音量。",
    speakerphoneRequired: payload?.speakerphoneRequired ?? true,
    reason: payload?.reason ?? null,
  };
}

function riskRank(level: RiskLevel) {
  return { low: 1, medium: 2, high: 3 }[level] ?? 1;
}

async function checkAndroidPermission(permission: string) {
  if (Platform.OS !== "android") {
    return true;
  }

  try {
    return await PermissionsAndroid.check(permission as never);
  } catch {
    return false;
  }
}

async function checkAndroidNotificationPermission() {
  if (Platform.OS !== "android" || Platform.Version < 33) {
    return true;
  }

  try {
    return await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  } catch {
    return false;
  }
}

function hasRequiredDetectionPermissions(status: NativeDetectionStatus) {
  return Boolean(
    status.callScreeningEnabled &&
      status.phoneStatePermissionGranted &&
      status.contactsPermissionGranted &&
      status.overlayPermissionGranted
  );
}

export function CallInterventionProvider({ children }: { children: ReactNode }) {
  const { token, status, user } = useAuth();
  const [incomingRisk, setIncomingRisk] = useState<IncomingRiskEvent | null>(null);
  const [recording, setRecording] = useState<RecordingStatus>(defaultRecording());
  const [transcriptSegments, setTranscriptSegments] = useState<TranscriptSegment[]>([]);
  const [liveTranscriptPreview, setLiveTranscriptPreview] = useState("");
  const [liveRiskEvents, setLiveRiskEvents] = useState<RiskEvent[]>([]);
  const [sessionHistory, setSessionHistory] = useState<CallSession[]>([]);
  const [activeSession, setActiveSession] = useState<CallSession | null>(null);
  const [warning, setWarning] = useState<{ level: RiskLevel; message: string } | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [permissionGuideVisible, setPermissionGuideVisible] = useState(false);
  const [permissionGuideLoaded, setPermissionGuideLoaded] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const finalizingRef = useRef(false);
  const attachingNativeRecordingRef = useRef<string | null>(null);
  const syncingNativeRecordingRef = useRef<string | null>(null);
  const transcriptRef = useRef<TranscriptSegment[]>([]);
  const riskEventsRef = useRef<RiskEvent[]>([]);
  const recordingRef = useRef<RecordingStatus>(defaultRecording());
  const appStateRef = useRef(AppState.currentState);
  const pendingOverlayPermissionRef = useRef(false);
  const overlayPermissionGrantedRef = useRef(false);

  const nativeAvailable = Platform.OS === "android" && fraudInterventionNativeLoaded;
  const [nativeDetectionStatus, setNativeDetectionStatus] = useState<NativeDetectionStatus>(() =>
    defaultNativeDetectionStatus(nativeAvailable)
  );

  useEffect(() => {
    transcriptRef.current = transcriptSegments;
  }, [transcriptSegments]);

  useEffect(() => {
    riskEventsRef.current = liveRiskEvents;
  }, [liveRiskEvents]);

  useEffect(() => {
    recordingRef.current = recording;
  }, [recording]);

  useEffect(() => {
    overlayPermissionGrantedRef.current = nativeDetectionStatus.overlayPermissionGranted;
  }, [nativeDetectionStatus.overlayPermissionGranted]);

  useEffect(() => {
    if (!nativeAvailable) {
      return;
    }
    void fraudInterventionModule.configureLookup(API_BASE);
  }, [nativeAvailable]);

  useEffect(() => {
    if (!nativeAvailable) {
      return;
    }

    void fraudInterventionModule.setAppActiveState(appStateRef.current === "active");

    return () => {
      void fraudInterventionModule.setAppActiveState(false);
    };
  }, [nativeAvailable]);

  const refreshNativeDetectionStatus = useCallback(async () => {
    const base = nativeAvailable
      ? await fraudInterventionModule.getCallDetectionStatusAsync().catch(() => defaultNativeDetectionStatus(true))
      : defaultNativeDetectionStatus(false);

    const recordAudioPermissionGranted = await checkAndroidPermission(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
    const notificationPermissionGranted = await checkAndroidNotificationPermission();

    const nextStatus = {
      ...base,
      recordAudioPermissionGranted,
      notificationPermissionGranted,
    };
    overlayPermissionGrantedRef.current = nextStatus.overlayPermissionGranted;
    setNativeDetectionStatus(nextStatus);
    return nextStatus;
  }, [nativeAvailable]);

  const showOverlayPreview = useCallback(async () => {
    if (!nativeAvailable) {
      return false;
    }

    try {
      return await fraudInterventionModule.showOverlayPreviewAsync();
    } catch {
      return false;
    }
  }, [nativeAvailable]);

  const requestRuntimeDetectionPermissions = useCallback(async () => {
    if (Platform.OS !== "android") {
      await refreshNativeDetectionStatus();
      return;
    }

    const permissions = [PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE];
    if (typeof PermissionsAndroid.PERMISSIONS.READ_CONTACTS === "string") {
      permissions.push(PermissionsAndroid.PERMISSIONS.READ_CONTACTS);
    }
    if (Platform.Version >= 33) {
      permissions.push(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
    }

    try {
      await PermissionsAndroid.requestMultiple(permissions);
    } catch {
    }

    await refreshNativeDetectionStatus();
  }, [refreshNativeDetectionStatus]);

  const requestRecordingPermission = useCallback(async () => {
    if (Platform.OS !== "android") {
      return true;
    }

    try {
      const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
      await refreshNativeDetectionStatus();
      return result === PermissionsAndroid.RESULTS.GRANTED;
    } catch {
      await refreshNativeDetectionStatus();
      return false;
    }
  }, [refreshNativeDetectionStatus]);

  const requestCallScreeningRole = useCallback(async () => {
    if (!nativeAvailable) {
      return;
    }

    let requestStarted = false;
    try {
      requestStarted = await fraudInterventionModule.requestCallScreeningRoleAsync();
    } catch {
    }

    await refreshNativeDetectionStatus();

    if (!requestStarted) {
      Alert.alert(
        "未能直接打开系统来电识别设置",
        "请手动前往系统默认应用设置，将本应用设置为来电识别或骚扰拦截应用。完成后回到 App 再刷新状态。"
      );
    }
  }, [nativeAvailable, refreshNativeDetectionStatus]);

  const openOverlayPermissionSettings = useCallback(async () => {
    if (!nativeAvailable) {
      Alert.alert("当前设备不支持", "需要安卓设备才能使用系统来电预警与录音能力。");
      return;
    }

    if (overlayPermissionGrantedRef.current) {
      await refreshNativeDetectionStatus();
      await showOverlayPreview();
      return;
    }

    pendingOverlayPermissionRef.current = true;
    let opened = false;
    try {
      opened = await fraudInterventionModule.openOverlayPermissionSettingsAsync();
    } catch {
    }

    if (!opened) {
      pendingOverlayPermissionRef.current = false;
      Alert.alert("未能打开悬浮窗设置", "请手动前往系统设置，为当前应用开启显示在其他应用上层。");
    }
  }, [nativeAvailable, refreshNativeDetectionStatus, showOverlayPreview]);

  const prepareIncomingCallDetection = useCallback(async () => {
    await requestRuntimeDetectionPermissions();
    const hasMicPermission = await requestRecordingPermission();
    await requestCallScreeningRole();

    const latestStatus = nativeAvailable
      ? await fraudInterventionModule.getCallDetectionStatusAsync().catch(() => nativeDetectionStatus)
      : nativeDetectionStatus;

    if (!latestStatus.overlayPermissionGranted) {
      Alert.alert("建议开启悬浮提醒权限", "这样在 App 不在前台时，也能看到风险提醒和录音状态。", [
        { text: "以后再说", style: "cancel" },
        {
          text: "去设置",
          onPress: () => {
            void openOverlayPermissionSettings();
          },
        },
      ]);
    } else {
      await showOverlayPreview();
    }

    if (!hasMicPermission) {
      Alert.alert("建议开启录音权限", "开启后才能在通话中保存录音并生成实时转写。");
    }

    setPermissionGuideVisible(false);
    if (user?.id) {
      await setCallPermissionGuideSeen(user.id);
    }
    await refreshNativeDetectionStatus();
  }, [
    nativeAvailable,
    nativeDetectionStatus,
    openOverlayPermissionSettings,
    refreshNativeDetectionStatus,
    requestCallScreeningRole,
    requestRecordingPermission,
    requestRuntimeDetectionPermissions,
    showOverlayPreview,
    user?.id,
  ]);

  useEffect(() => {
    void refreshNativeDetectionStatus();
  }, [refreshNativeDetectionStatus]);

  useEffect(() => {
    if (Platform.OS !== "android") {
      return;
    }

    const subscription = AppState.addEventListener("change", (nextState) => {
      appStateRef.current = nextState;
      if (nativeAvailable) {
        void fraudInterventionModule.setAppActiveState(nextState === "active");
      }
      if (nextState === "active") {
        void (async () => {
          const latestStatus = await refreshNativeDetectionStatus();
          if (pendingOverlayPermissionRef.current) {
            pendingOverlayPermissionRef.current = false;
            if (latestStatus.overlayPermissionGranted) {
              await showOverlayPreview();
            }
          }
        })();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [nativeAvailable, refreshNativeDetectionStatus, showOverlayPreview]);

  useEffect(() => {
    if (status !== "authenticated" || !user?.id) {
      setPermissionGuideLoaded(false);
      setPermissionGuideVisible(false);
      return;
    }

    const userId = user.id;
    let cancelled = false;

    async function loadGuideVisibility() {
      const seen = await getCallPermissionGuideSeen(userId);
      if (cancelled) {
        return;
      }

      setPermissionGuideLoaded(true);
      if (!seen && !hasRequiredDetectionPermissions(nativeDetectionStatus)) {
        setPermissionGuideVisible(true);
      }
    }

    void loadGuideVisibility();

    return () => {
      cancelled = true;
    };
  }, [nativeDetectionStatus, status, user?.id]);

  const closeSocket = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
  }, []);

  const finalizeAsrStream = useCallback(async () => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }

    try {
      ws.send(JSON.stringify({ type: "finalize" }));
      await new Promise((resolve) => setTimeout(resolve, 450));
    } catch {
    }
  }, []);

  const refreshHistory = useCallback(async () => {
    if (!token) {
      setSessionHistory([]);
      return;
    }

    try {
      const rows = await callInterventionApi.listSessions(token);
      setSessionHistory(rows);
    } catch {
    }
  }, [token]);

  const buildSessionSeed = useCallback(
    async (options?: ManualRecordingOptions & { riskLevel?: RiskLevel }): Promise<SessionSeed> => {
      const fallbackPhoneNumber = options?.phoneNumber?.trim() ?? "";
      let phoneNumber = incomingRisk?.phoneNumber ?? recordingRef.current.phoneNumber ?? fallbackPhoneNumber;
      let riskLevel = (incomingRisk?.riskLevel ?? recordingRef.current.riskLevel ?? options?.riskLevel ?? "low") as RiskLevel;
      let riskLabels = incomingRisk?.labels ?? [];

      if (phoneNumber && token) {
        try {
          const lookup = await callInterventionApi.lookupNumber({ phone_number: phoneNumber }, token);
          phoneNumber = lookup.phone_number;
          riskLevel = lookup.risk_level;
          riskLabels = lookup.labels;
          setIncomingRisk((prev) => ({
            callId: prev?.callId ?? `manual-${Date.now()}`,
            phoneNumber: lookup.phone_number,
            riskLevel: lookup.risk_level,
            labels: lookup.labels,
            message: lookup.suggestion,
            suggestedAction: "manual_recording",
          }));
        } catch {
        }
      }

      return {
        phoneNumber: (phoneNumber || "manual_unknown").trim(),
        riskLevel,
        riskLabels: riskLabels.length > 0 ? riskLabels : ["manual_analysis"],
        callDirection: options?.callDirection ?? "incoming",
      };
    },
    [incomingRisk, token]
  );

  const connectAsrSocket = useCallback(
    (sessionId: string) => {
      if (!token) {
        return;
      }

      closeSocket();
      const ws = new WebSocket(
        `${resolveCallInterventionWsBase()}/api/call-intervention/asr/stream?session_id=${encodeURIComponent(
          sessionId
        )}&token=${encodeURIComponent(token)}`
      );
      wsRef.current = ws;
      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as WsMessage;
          if (payload.type === "transcript_partial" && "segment" in payload) {
            const segment = payload.segment as TranscriptSegment;
            setLiveTranscriptPreview(segment.text);
            return;
          }
          if (payload.type === "transcript" && "segment" in payload) {
            const segment = payload.segment as TranscriptSegment;
            setLiveTranscriptPreview(segment.text);
            setTranscriptSegments((prev) => {
              if (prev.some((item) => item.id === segment.id)) {
                return prev;
              }
              const next = [...prev, segment];
              transcriptRef.current = next;
              return next;
            });
            return;
          }
          if (payload.type === "risk_event" && "event" in payload) {
            const riskEvent = payload.event as RiskEvent;
            setLiveRiskEvents((prev) => {
              if (prev.some((item) => item.id === riskEvent.id)) {
                return prev;
              }
              const next = [...prev, riskEvent];
              riskEventsRef.current = next;
              return next;
            });
            if (appStateRef.current === "active") {
              setWarning({ level: riskEvent.risk_level, message: riskEvent.message });
            }
            void fraudInterventionModule.showRiskWarning(riskEvent.risk_level, riskEvent.message);
            return;
          }
          if (payload.type === "error" && "message" in payload && typeof payload.message === "string") {
            Alert.alert("实时转写异常", payload.message);
          }
        } catch {
        }
      };
    },
    [closeSocket, token]
  );

  const finalizeSession = useCallback(
    async (statusFromNative?: RecordingStatus) => {
      if (!token || !activeSessionIdRef.current || finalizingRef.current) {
        return;
      }

      finalizingRef.current = true;
      const sessionId = activeSessionIdRef.current;
      const currentRecording = statusFromNative ?? recordingRef.current;

      try {
        await finalizeAsrStream();

        const transcriptFullText = transcriptRef.current.map((item) => item.text).join("\n").trim();
        const riskLevelFinal = riskEventsRef.current.reduce<RiskLevel>((current, item) => {
          return riskRank(item.risk_level) > riskRank(current) ? item.risk_level : current;
        }, currentRecording.riskLevel || "low");

        if (currentRecording.finalFilePath) {
          await callInterventionApi.uploadRecording(sessionId, currentRecording.finalFilePath, token);
        }

        await callInterventionApi.stopSession(
          {
            session_id: sessionId,
            transcript_full_text: transcriptFullText || undefined,
            risk_level_final: riskLevelFinal,
            audio_duration_ms: currentRecording.durationMs || undefined,
          },
          token
        );

        const detail = await callInterventionApi.getSession(sessionId, token);
        setActiveSession(detail);
        setSessionHistory((prev) => [detail, ...prev.filter((item) => item.id !== detail.id)].slice(0, 20));
        await fraudInterventionModule.clearCompletedRecording(currentRecording.callId);
        setRecording(defaultRecording());
      } catch (error) {
        const message = error instanceof ApiError ? error.message : "通话会话保存失败，请稍后重试。";
        Alert.alert("保存失败", message);
      } finally {
        activeSessionIdRef.current = null;
        finalizingRef.current = false;
        closeSocket();
      }
    },
    [closeSocket, finalizeAsrStream, token]
  );

  const attachSessionToNativeRecording = useCallback(
    async (nativeRecording: RecordingStatus) => {
      if (!token || !nativeRecording.isRecording || activeSessionIdRef.current || !nativeRecording.callId) {
        return;
      }
      if (attachingNativeRecordingRef.current === nativeRecording.callId) {
        return;
      }

      attachingNativeRecordingRef.current = nativeRecording.callId;
      try {
        const seed = await buildSessionSeed({
          phoneNumber: nativeRecording.phoneNumber,
          riskLevel: nativeRecording.riskLevel,
          callDirection: "incoming",
        });
        const session = await callInterventionApi.startSession(
          {
            phone_number: seed.phoneNumber,
            call_direction: seed.callDirection,
            risk_level_initial: seed.riskLevel,
            risk_labels: seed.riskLabels,
          },
          token
        );
        setActiveSession(session);
        activeSessionIdRef.current = session.id;
        connectAsrSocket(session.id);
      } catch {
      } finally {
        attachingNativeRecordingRef.current = null;
      }
    },
    [buildSessionSeed, connectAsrSocket, token]
  );

  const syncCompletedNativeRecording = useCallback(
    async (nativeRecording: RecordingStatus) => {
      if (
        !token ||
        nativeRecording.isRecording ||
        nativeRecording.status !== "stopped" ||
        activeSessionIdRef.current ||
        !nativeRecording.callId ||
        !nativeRecording.finalFilePath
      ) {
        return;
      }
      if (syncingNativeRecordingRef.current === nativeRecording.callId) {
        return;
      }

      syncingNativeRecordingRef.current = nativeRecording.callId;
      try {
        const seed = await buildSessionSeed({
          phoneNumber: nativeRecording.phoneNumber,
          riskLevel: nativeRecording.riskLevel,
          callDirection: "incoming",
        });
        const session = await callInterventionApi.startSession(
          {
            phone_number: seed.phoneNumber,
            call_direction: seed.callDirection,
            risk_level_initial: seed.riskLevel,
            risk_labels: seed.riskLabels,
          },
          token
        );

        await callInterventionApi.uploadRecording(session.id, nativeRecording.finalFilePath, token);
        await callInterventionApi.stopSession(
          {
            session_id: session.id,
            risk_level_final: nativeRecording.riskLevel,
            audio_duration_ms: nativeRecording.durationMs || undefined,
          },
          token
        );

        const detail = await callInterventionApi.getSession(session.id, token);
        setActiveSession(detail);
        setSessionHistory((prev) => [detail, ...prev.filter((item) => item.id !== detail.id)].slice(0, 20));
        await fraudInterventionModule.clearCompletedRecording(nativeRecording.callId);
        setRecording(defaultRecording());
      } catch {
      } finally {
        syncingNativeRecordingRef.current = null;
      }
    },
    [buildSessionSeed, token]
  );

  const handleIncomingRisk = useCallback(
    async (payload: IncomingRiskEvent) => {
      const normalized = normalizeIncomingRisk(payload);
      if (!normalized) {
        return;
      }

      setIncomingRisk(normalized);
      if (appStateRef.current === "active") {
        setWarning({ level: normalized.riskLevel, message: normalized.message });
      }

      if (!token) {
        return;
      }

      try {
        const enriched = await callInterventionApi.lookupNumber({ phone_number: normalized.phoneNumber }, token);
        setIncomingRisk((prev) => {
          if (!prev) {
            return prev;
          }

          return {
            ...prev,
            riskLevel: enriched.risk_level,
            labels: enriched.labels,
            message: enriched.suggestion,
          };
        });

        if (appStateRef.current === "active" && enriched.risk_level !== "low") {
          setWarning({ level: enriched.risk_level, message: enriched.suggestion });
        }
      } catch {
      }
    },
    [token]
  );

  const handleRecordingStatus = useCallback(
    async (payload: RecordingStatus) => {
      const normalized = normalizeRecording(payload);
      setRecording(normalized);
      if (normalized.status === "stopped" && activeSessionIdRef.current) {
        await finalizeSession(normalized);
      }
    },
    [finalizeSession]
  );

  const handleAudioChunk = useCallback((payload: AudioChunkEvent) => {
    setRecording((prev) =>
      prev.isRecording
        ? {
            ...prev,
            durationMs: Math.max(prev.durationMs, payload.durationMs),
            segmentCount: Math.max(prev.segmentCount, payload.seq),
          }
        : prev
    );

    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }

    ws.send(
      JSON.stringify({
        type: "audio_chunk",
        seq: payload.seq,
        duration_ms: payload.durationMs,
        chunk_base64: payload.chunkBase64,
      })
    );
  }, []);

  const handleWarning = useCallback((payload: NativeRiskWarningEvent) => {
    if (appStateRef.current === "active") {
      setWarning({ level: payload.level, message: payload.message });
    }
  }, []);

  useEffect(() => {
    void fraudInterventionModule.getStatusAsync().then((payload) => {
      const normalizedIncoming = normalizeIncomingRisk(payload.incomingRisk);
      const normalizedRecording = normalizeRecording(payload.recording);
      setIncomingRisk(normalizedIncoming);
      setRecording(normalizedRecording);
      if (normalizedIncoming && appStateRef.current === "active" && normalizedIncoming.riskLevel !== "low") {
        setWarning({ level: normalizedIncoming.riskLevel, message: normalizedIncoming.message });
      }
    });

    const subIncoming = fraudInterventionModule.addListener("onIncomingRisk", (payload: IncomingRiskEvent) => {
      void handleIncomingRisk(payload);
    });
    const subStatus = fraudInterventionModule.addListener("onRecordingStatus", (payload: RecordingStatus) => {
      void handleRecordingStatus(payload);
    });
    const subChunk = fraudInterventionModule.addListener("onAudioChunk", handleAudioChunk);
    const subWarning = fraudInterventionModule.addListener("onRiskWarning", handleWarning);

    return () => {
      subIncoming.remove();
      subStatus.remove();
      subChunk.remove();
      subWarning.remove();
      closeSocket();
    };
  }, [closeSocket, handleAudioChunk, handleIncomingRisk, handleRecordingStatus, handleWarning]);

  useEffect(() => {
    if (status === "authenticated") {
      void refreshHistory();
      return;
    }

    setSessionHistory([]);
  }, [refreshHistory, status]);

  useEffect(() => {
    if (!nativeAvailable || !recording.isRecording) {
      return;
    }

    const latestText = liveTranscriptPreview.trim() || transcriptSegments.slice(-1)[0]?.text?.trim() || "";
    void fraudInterventionModule.updateRecordingOverlayTranscript(latestText);
  }, [liveTranscriptPreview, nativeAvailable, recording.isRecording, transcriptSegments]);

  useEffect(() => {
    if (recording.isRecording && recording.callId && !activeSessionIdRef.current) {
      void attachSessionToNativeRecording(recording);
    }
  }, [attachSessionToNativeRecording, recording]);

  useEffect(() => {
    if (recording.status === "stopped" && recording.callId && !activeSessionIdRef.current) {
      void syncCompletedNativeRecording(recording);
    }
  }, [recording, syncCompletedNativeRecording]);

  const startManualRecording = useCallback(
    async (options?: ManualRecordingOptions) => {
      if (!token) {
        Alert.alert("请先登录", "登录后才能开始来电识别和录音。");
        return;
      }

      const hasMicPermission = await requestRecordingPermission();
      if (!hasMicPermission) {
        Alert.alert("未开启录音权限", "请先允许麦克风录音，再开启免提录音。");
        return;
      }

      setIsBusy(true);
      try {
        setTranscriptSegments([]);
        transcriptRef.current = [];
        setLiveTranscriptPreview("");
        setLiveRiskEvents([]);
        riskEventsRef.current = [];

        const seed = await buildSessionSeed({
          phoneNumber: options?.phoneNumber ?? recording.phoneNumber,
          riskLevel: recording.riskLevel,
          callDirection: options?.callDirection ?? "incoming",
        });

        const session = await callInterventionApi.startSession(
          {
            phone_number: seed.phoneNumber,
            call_direction: seed.callDirection,
            risk_level_initial: seed.riskLevel,
            risk_labels: seed.riskLabels,
          },
          token
        );
        setActiveSession(session);
        activeSessionIdRef.current = session.id;
        connectAsrSocket(session.id);
        await fraudInterventionModule.startFraudRecording(session.id, seed.riskLevel, seed.phoneNumber);
      } catch (error) {
        const message = error instanceof ApiError ? error.message : "启动录音失败。";
        Alert.alert("启动失败", message);
      } finally {
        setIsBusy(false);
      }
    },
    [buildSessionSeed, connectAsrSocket, recording.phoneNumber, recording.riskLevel, requestRecordingPermission, token]
  );

  const stopManualRecording = useCallback(async () => {
    const targetCallId = activeSessionIdRef.current ?? recordingRef.current.callId;
    if (!targetCallId) {
      return;
    }

    setIsBusy(true);
    try {
      await fraudInterventionModule.stopFraudRecording(targetCallId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "停止录音失败。";
      Alert.alert("停止失败", message);
    } finally {
      setIsBusy(false);
    }
  }, []);

  const resetDashboardState = useCallback(() => {
    setIncomingRisk(null);
    setTranscriptSegments([]);
    transcriptRef.current = [];
    setLiveTranscriptPreview("");
    setLiveRiskEvents([]);
    riskEventsRef.current = [];
    setWarning(null);
  }, []);

  const value = useMemo<CallInterventionContextValue>(
    () => ({
      incomingRisk,
      recording,
      transcriptSegments,
      liveTranscriptPreview,
      liveRiskEvents,
      sessionHistory,
      activeSession,
      isBusy,
      nativeDetectionStatus,
      refreshHistory,
      refreshNativeDetectionStatus,
      prepareIncomingCallDetection,
      requestRuntimeDetectionPermissions,
      requestCallScreeningRole,
      requestRecordingPermission,
      openOverlayPermissionSettings,
      startManualRecording,
      stopManualRecording,
      dismissIncomingRisk: () => setIncomingRisk(null),
      dismissWarning: () => setWarning(null),
      openPermissionGuide: () => setPermissionGuideVisible(true),
      resetDashboardState,
      nativeAvailable,
    }),
    [
      activeSession,
      incomingRisk,
      isBusy,
      liveRiskEvents,
      liveTranscriptPreview,
      nativeAvailable,
      nativeDetectionStatus,
      openOverlayPermissionSettings,
      prepareIncomingCallDetection,
      recording,
      refreshHistory,
      refreshNativeDetectionStatus,
      requestCallScreeningRole,
      requestRecordingPermission,
      requestRuntimeDetectionPermissions,
      resetDashboardState,
      sessionHistory,
      startManualRecording,
      stopManualRecording,
      transcriptSegments,
    ]
  );

  return (
    <CallInterventionContext.Provider value={value}>
      {children}
      {permissionGuideLoaded ? (
        <CallPermissionGuideModal
          visible={permissionGuideVisible}
          onClose={() => {
            setPermissionGuideVisible(false);
            if (user?.id) {
              void setCallPermissionGuideSeen(user.id);
            }
          }}
          onEnableDetection={() => {
            void prepareIncomingCallDetection();
          }}
        />
      ) : null}
      <RiskWarningModal
        visible={!nativeAvailable && Boolean(warning)}
        warning={warning}
        phoneNumber={incomingRisk?.phoneNumber ?? recording.phoneNumber}
        isRecording={recording.isRecording}
        transcriptPreview={liveTranscriptPreview || transcriptSegments.slice(-1).map((item) => item.text).join(" ")}
        onClose={() => setWarning(null)}
        onPrimaryAction={() => {
          if (recording.isRecording) {
            Alert.alert("结束录音", "确认结束当前录音并保存录音文件？", [
              { text: "继续录音", style: "cancel" },
              {
                text: "结束录音",
                style: "destructive",
                onPress: () => {
                  void stopManualRecording();
                },
              },
            ]);
            return;
          }

          void startManualRecording({
            phoneNumber: incomingRisk?.phoneNumber ?? recording.phoneNumber,
            callDirection: "incoming",
          });
        }}
      />
    </CallInterventionContext.Provider>
  );
}

export function useCallIntervention() {
  const context = useContext(CallInterventionContext);
  if (!context) {
    throw new Error("useCallIntervention must be used within CallInterventionProvider");
  }
  return context;
}
