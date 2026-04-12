import { Platform } from "react-native";

export const palette = {
  background: "#f5efe5",
  surface: "#fbf8f2",
  surfaceStrong: "#efe5d7",
  ink: "#202722",
  inkSoft: "#556159",
  accent: "#216b58",
  accentStrong: "#18483d",
  accentSoft: "#d7e7dd",
  warm: "#ba7246",
  warmSoft: "#f2ddd0",
  line: "#d7ccbf",
  lineStrong: "#a79d91",
  danger: "#b15a3c",
  white: "#fffdf8",
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
  md: 20,
  lg: 28,
  xl: 38,
  pill: 999,
};

export const panelShadow = {
  shadowColor: "#5d4733",
  shadowOpacity: 0.08,
  shadowRadius: 26,
  shadowOffset: {
    width: 0,
    height: 18,
  },
  elevation: 8,
};
