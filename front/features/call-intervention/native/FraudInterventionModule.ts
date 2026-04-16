import { EventEmitter, requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";

import type {
  AudioChunkEvent,
  IncomingRiskEvent,
  NativeDetectionStatus,
  NativeRiskWarningEvent,
  RecordingStatus,
  RiskLevel,
} from "../types";

type FraudInterventionEvents = {
  onIncomingRisk: (payload: IncomingRiskEvent) => void;
  onRecordingStatus: (payload: RecordingStatus) => void;
  onAudioChunk: (payload: AudioChunkEvent) => void;
  onRiskWarning: (payload: NativeRiskWarningEvent) => void;
};

export type FraudInterventionNativeModule = {
  addListener<EventName extends keyof FraudInterventionEvents>(
    eventName: EventName,
    listener: FraudInterventionEvents[EventName]
  ): { remove(): void };
  removeAllListeners(eventName: keyof FraudInterventionEvents): void;
  getStatusAsync(): Promise<{
    incomingRisk?: Partial<IncomingRiskEvent> | null;
    recording?: Partial<RecordingStatus> | null;
  }>;
  getCallDetectionStatusAsync(): Promise<NativeDetectionStatus>;
  configureLookup(apiBaseUrl: string | null): Promise<void>;
  requestCallScreeningRoleAsync(): Promise<boolean>;
  openOverlayPermissionSettingsAsync(): Promise<boolean>;
  showOverlayPreviewAsync(): Promise<boolean>;
  setAppActiveState(isActive: boolean): Promise<void>;
  updateRecordingOverlayTranscript(text: string): Promise<void>;
  clearCompletedRecording(callId?: string | null): Promise<void>;
  startFraudRecording(callId: string, riskLevel: RiskLevel, phoneNumber?: string | null): Promise<unknown>;
  stopFraudRecording(callId: string): Promise<unknown>;
  showRiskWarning(level: RiskLevel, text: string): Promise<void>;
};

function createDefaultRecordingStatus(): RecordingStatus {
  return {
    status: "idle",
    callId: null,
    phoneNumber: null,
    riskLevel: "low",
    isRecording: false,
    finalFilePath: null,
    segmentCount: 0,
    durationMs: 0,
    reason: null,
  };
}

class FraudInterventionFallback extends EventEmitter<FraudInterventionEvents> {
  private incomingRisk: Partial<IncomingRiskEvent> | null = null;
  private recording = createDefaultRecordingStatus();

  async getStatusAsync() {
    return {
      incomingRisk: this.incomingRisk,
      recording: this.recording,
    };
  }

  async configureLookup(_apiBaseUrl: string | null) {
    return;
  }

  async getCallDetectionStatusAsync(): Promise<NativeDetectionStatus> {
    return {
      callScreeningEnabled: false,
      canRequestCallScreeningRole: false,
      phoneStatePermissionGranted: false,
      contactsPermissionGranted: false,
      overlayPermissionGranted: false,
      recordAudioPermissionGranted: false,
      notificationPermissionGranted: false,
    };
  }

  async requestCallScreeningRoleAsync() {
    return false;
  }

  async openOverlayPermissionSettingsAsync() {
    return false;
  }

  async showOverlayPreviewAsync() {
    return false;
  }

  async setAppActiveState(_isActive: boolean) {
    return;
  }

  async updateRecordingOverlayTranscript(_text: string) {
    return;
  }

  async clearCompletedRecording(callId?: string | null) {
    if (!callId || this.recording.callId === callId) {
      this.recording = createDefaultRecordingStatus();
    }
  }

  async startFraudRecording(callId: string, riskLevel: RiskLevel, phoneNumber?: string | null) {
    this.recording = {
      ...this.recording,
      status: "recording",
      callId,
      phoneNumber: phoneNumber ?? null,
      riskLevel,
      isRecording: true,
      finalFilePath: null,
    };
    this.emit("onRecordingStatus", this.recording);
  }

  async stopFraudRecording(callId: string) {
    this.recording = {
      ...this.recording,
      status: "stopped",
      callId,
      isRecording: false,
      finalFilePath: null,
      reason: "fallback",
    };
    this.emit("onRecordingStatus", this.recording);
  }

  async showRiskWarning(level: RiskLevel, text: string) {
    this.emit("onRiskWarning", { level, message: text });
  }
}

const nativeModule =
  Platform.OS === "android"
    ? (requireOptionalNativeModule("FraudIntervention") as FraudInterventionNativeModule | null)
    : null;

export const fraudInterventionNativeLoaded = nativeModule != null;

export const fraudInterventionModule: FraudInterventionNativeModule =
  nativeModule ?? (new FraudInterventionFallback() as FraudInterventionNativeModule);
