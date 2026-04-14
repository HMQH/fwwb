import type { PickedFile } from "@/features/detections/types";

export type FloatingCaptureStatus = {
  platformSupported: boolean;
  overlayPermission: boolean;
  bubbleActive: boolean;
  hasPendingCapture: boolean;
  screenCapturePermission: boolean;
};

export type FloatingCapturedImage = PickedFile;
