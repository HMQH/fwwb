import { NativeModules, Platform } from "react-native";

import type { FloatingCapturedImage, FloatingCaptureStatus } from "./types";

type NativeFloatingCaptureModule = {
  getStatus: () => Promise<FloatingCaptureStatus>;
  openOverlaySettings: () => void;
  startAssistant: () => Promise<FloatingCaptureStatus>;
  stopAssistant: () => Promise<FloatingCaptureStatus>;
  consumePendingCapture: () => Promise<FloatingCapturedImage | null>;
};

const fallbackStatus: FloatingCaptureStatus = {
  platformSupported: false,
  overlayPermission: false,
  bubbleActive: false,
  hasPendingCapture: false,
  screenCapturePermission: false,
};

function getNativeModule(): NativeFloatingCaptureModule | null {
  if (Platform.OS !== "android") {
    return null;
  }

  return (
    (NativeModules.FloatingCapture as NativeFloatingCaptureModule | undefined | null) ??
    null
  );
}

export const floatingCaptureService = {
  isSupported() {
    return Boolean(getNativeModule());
  },

  async getStatus(): Promise<FloatingCaptureStatus> {
    const nativeModule = getNativeModule();
    if (!nativeModule) {
      return fallbackStatus;
    }

    return nativeModule.getStatus();
  },

  openOverlaySettings() {
    getNativeModule()?.openOverlaySettings();
  },

  async startAssistant(): Promise<FloatingCaptureStatus> {
    const nativeModule = getNativeModule();
    if (!nativeModule) {
      return fallbackStatus;
    }

    return nativeModule.startAssistant();
  },

  async stopAssistant(): Promise<FloatingCaptureStatus> {
    const nativeModule = getNativeModule();
    if (!nativeModule) {
      return fallbackStatus;
    }

    return nativeModule.stopAssistant();
  },

  async consumePendingCapture(): Promise<FloatingCapturedImage | null> {
    const nativeModule = getNativeModule();
    if (!nativeModule) {
      return null;
    }

    return nativeModule.consumePendingCapture();
  },
};
