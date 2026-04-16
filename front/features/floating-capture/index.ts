export { floatingCaptureService } from "./service";
export {
  clearRecentFloatingCaptureDraft,
  consumeStagedFloatingCapture,
  patchRecentFloatingCaptureUpload,
  peekRecentFloatingCaptureDraft,
  setRecentFloatingCaptureDraft,
  stageRecentFloatingCapture,
} from "./session";
export type { FloatingCapturedImage, FloatingCaptureStatus } from "./types";
export type { FloatingCaptureDraft, FloatingCaptureFile, FloatingCaptureTarget } from "./session";
