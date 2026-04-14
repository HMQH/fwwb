import { Platform } from "react-native";

export const palette = {
  background: "#F5F9FF",
  backgroundDeep: "#EAF3FF",
  backgroundRaised: "#FFFFFF",
  backgroundMuted: "#DCEAFF",
  surface: "#FFFFFF",
  surfaceSoft: "#F4F8FF",
  surfaceStrong: "#E8F1FF",
  ink: "#234A78",
  inkSoft: "#7C95B4",
  inkInverse: "#FFFFFF",
  accent: "#4B8DF8",
  accentStrong: "#2F70E6",
  accentSoft: "#E6F0FF",
  shield: "#93BCFF",
  shieldSoft: "#D8E8FF",
  warm: "#4B8DF8",
  warmSoft: "#E6F0FF",
  danger: "#2F70E6",
  dangerSoft: "#EEF5FF",
  success: "#4B8DF8",
  successSoft: "#E6F0FF",
  line: "#D6E4FA",
  lineStrong: "#9DBBE3",
  overlay: "rgba(75, 141, 248, 0.14)",
  white: "#FFFFFF",
};

export const fontFamily = Platform.select({
  ios: {
    display: "Avenir Next",
    body: "PingFang SC",
  },
  android: {
    display: "sans-serif-medium",
    body: "sans-serif",
  },
  default: {
    display: "Segoe UI",
    body: "Segoe UI",
  },
}) as { display: string; body: string };

export const radius = {
  sm: 12,
  md: 18,
  lg: 24,
  xl: 32,
  pill: 999,
};

export const panelShadow = {
  shadowColor: "#ABC9F4",
  shadowOpacity: 0.18,
  shadowRadius: 24,
  shadowOffset: {
    width: 0,
    height: 12,
  },
  elevation: 10,
};
