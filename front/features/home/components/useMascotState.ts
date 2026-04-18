import { useMemo } from "react";

export type MascotVisualState = "grounded" | "sleepy" | "guarding" | "bright";

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

/** 由安全分推导吉祥物姿态；仅驱动动效，不展示分数或文案。 */
export function useMascotState(score: number): MascotVisualState {
  return useMemo(() => {
    const safeScore = clampScore(score);

    if (safeScore < 60) {
      return "grounded";
    }
    if (safeScore < 80) {
      return "sleepy";
    }
    if (safeScore < 90) {
      return "guarding";
    }
    return "bright";
  }, [score]);
}
