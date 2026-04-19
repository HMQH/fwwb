import { MaterialCommunityIcons } from "@expo/vector-icons";

import type { DetectionMode } from "../types";

export type DetectionFeatureKey =
  | "text"
  | "image"
  | "video-ai"
  | "video-physiology"
  | "ocr"
  | "official-document"
  | "pii"
  | "qr"
  | "impersonation"
  | "audio";

export type DetectionFeaturePreset = {
  key: DetectionFeatureKey;
  mode: DetectionMode;
  title: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  tint: string;
  soft: string;
  buttonLabel: string;
};

const presets: Record<DetectionFeatureKey, DetectionFeaturePreset> = {
  text: {
    key: "text",
    mode: "text",
    title: "文本检测",
    icon: "text-box-search-outline",
    tint: "#2F70E6",
    soft: "#EAF2FF",
    buttonLabel: "开始检测",
  },
  image: {
    key: "image",
    mode: "visual",
    title: "图片检测",
    icon: "image-search-outline",
    tint: "#6C63FF",
    soft: "#F2EEFF",
    buttonLabel: "开始检测",
  },
  "video-ai": {
    key: "video-ai",
    mode: "visual",
    title: "AI视频检测",
    icon: "movie-open-play-outline",
    tint: "#476CFF",
    soft: "#EEF2FF",
    buttonLabel: "开始检测",
  },
  "video-physiology": {
    key: "video-physiology",
    mode: "visual",
    title: "人物生理特征判断",
    icon: "account-heart-outline",
    tint: "#E06E55",
    soft: "#FFF0EA",
    buttonLabel: "开始判断",
  },
  ocr: {
    key: "ocr",
    mode: "visual",
    title: "OCR文字识别诈骗话术",
    icon: "text-recognition",
    tint: "#3388FF",
    soft: "#ECF4FF",
    buttonLabel: "开始检测",
  },
  "official-document": {
    key: "official-document",
    mode: "visual",
    title: "公章仿造",
    icon: "file-document-outline",
    tint: "#F08C38",
    soft: "#FFF3E8",
    buttonLabel: "开始检测",
  },
  pii: {
    key: "pii",
    mode: "visual",
    title: "敏感信息泄露检测",
    icon: "shield-key-outline",
    tint: "#E05C86",
    soft: "#FFF0F5",
    buttonLabel: "开始检测",
  },
  qr: {
    key: "qr",
    mode: "visual",
    title: "二维码检测URL风险检测",
    icon: "qrcode-scan",
    tint: "#5B6CFF",
    soft: "#EEF1FF",
    buttonLabel: "开始检测",
  },
  impersonation: {
    key: "impersonation",
    mode: "visual",
    title: "网图识别",
    icon: "image-filter-center-focus-weak",
    tint: "#7A63F6",
    soft: "#F3EEFF",
    buttonLabel: "开始检测",
  },
  audio: {
    key: "audio",
    mode: "audio",
    title: "语音检测",
    icon: "waveform",
    tint: "#169C8C",
    soft: "#EAF9F6",
    buttonLabel: "开始分析",
  },
};

export function resolveDetectionFeaturePreset(
  mode: DetectionMode,
  feature?: string | string[],
): DetectionFeaturePreset {
  const raw = Array.isArray(feature) ? feature[0] : feature;
  const normalized = (raw ?? "").trim().toLowerCase() as DetectionFeatureKey;

  if (
    normalized &&
    normalized in presets &&
    presets[normalized].mode === mode
  ) {
    return presets[normalized];
  }

  if (mode === "text") {
    return presets.text;
  }
  if (mode === "audio") {
    return presets.audio;
  }
  return presets.image;
}
