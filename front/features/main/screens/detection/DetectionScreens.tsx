import { DetectionModeScreen } from "@/features/detections";

/** Tab 外隐藏入口：与首页「混合检测」同模式，供路由 /submit 使用 */
export function SubmitDetectionScreen() {
  return <DetectionModeScreen mode="mixed" />;
}

export function DetectTextScreen() {
  return <DetectionModeScreen mode="text" />;
}

export function DetectVisualScreen() {
  return <DetectionModeScreen mode="visual" />;
}

export function DetectAudioScreen() {
  return <DetectionModeScreen mode="audio" />;
}

export function DetectMixedScreen() {
  return <DetectionModeScreen mode="mixed" />;
}
