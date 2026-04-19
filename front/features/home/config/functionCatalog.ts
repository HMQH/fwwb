import { MaterialCommunityIcons } from "@expo/vector-icons";

export type HomeFunctionEntry = {
  title: string;
  label: string;
  route: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  tint: string;
  soft: string;
};

export const primaryEntries: HomeFunctionEntry[] = [
  {
    title: "文本检测",
    label: "文本检测",
    route: "/detect-text",
    icon: "text-box-search-outline",
    tint: "#2F70E6",
    soft: "#EAF2FF",
  },
  {
    title: "图片检测",
    label: "图片检测",
    route: "/detect-visual?feature=image",
    icon: "image-search-outline",
    tint: "#6C63FF",
    soft: "#F2EEFF",
  },
  {
    title: "语音检测",
    label: "语音检测",
    route: "/detect-audio",
    icon: "waveform",
    tint: "#169C8C",
    soft: "#EAF9F6",
  },
  {
    title: "AI视频检测",
    label: "AI视频检测",
    route: "/detect-visual?feature=video-ai",
    icon: "movie-open-play-outline",
    tint: "#476CFF",
    soft: "#EEF2FF",
  },
  {
    title: "视频判谎",
    label: "视频判谎",
    route: "/detect-visual?feature=video-physiology",
    icon: "account-heart-outline",
    tint: "#E06E55",
    soft: "#FFF0EA",
  },
];

export const secondaryEntries: HomeFunctionEntry[] = [
  {
    title: "通话实时检测功能",
    label: "通话实时\n检测",
    route: "/call-intervention",
    icon: "phone-in-talk-outline",
    tint: "#22A06B",
    soft: "#EAF8F1",
  },
  {
    title: "OCR文字识别诈骗话术",
    label: "OCR话术\n识别",
    route: "/detect-ocr",
    icon: "text-recognition",
    tint: "#3388FF",
    soft: "#ECF4FF",
  },
  {
    title: "公章仿造",
    label: "公章\n仿造",
    route: "/detect-official-document",
    icon: "file-document-outline",
    tint: "#F08C38",
    soft: "#FFF3E8",
  },
  {
    title: "敏感信息泄露检测",
    label: "敏感信息\n检测",
    route: "/detect-pii",
    icon: "shield-key-outline",
    tint: "#E05C86",
    soft: "#FFF0F5",
  },
  {
    title: "二维码检测URL风险检测",
    label: "二维码URL\n风险",
    route: "/detect-qr",
    icon: "qrcode-scan",
    tint: "#5B6CFF",
    soft: "#EEF1FF",
  },
  {
    title: "网图识别",
    label: "网图\n识别",
    route: "/detect-impersonation",
    icon: "image-filter-center-focus-weak",
    tint: "#7A63F6",
    soft: "#F3EEFF",
  },
  {
    title: "独立网址钓鱼检测",
    label: "网址钓鱼\n检测",
    route: "/detect-web",
    icon: "web-check",
    tint: "#D68910",
    soft: "#FFF7E8",
  },
  {
    title: "AI语音识别",
    label: "AI语音\n识别",
    route: "/detect-audio-verify",
    icon: "microphone-outline",
    tint: "#18A999",
    soft: "#E9FBF7",
  },
  {
    title: "AI换脸检测",
    label: "AI换脸\n检测",
    route: "/detect-ai-face",
    icon: "face-recognition",
    tint: "#D65FA1",
    soft: "#FFF1F8",
  },
  {
    title: "悬浮窗截图",
    label: "悬浮窗\n截图",
    route: "/floating-capture/action",
    icon: "gesture-tap-button",
    tint: "#4C7DFF",
    soft: "#EEF5FF",
  },
];
