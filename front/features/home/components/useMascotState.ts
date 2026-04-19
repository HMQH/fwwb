export type MascotVisualState = "low" | "medium" | "high";

/** 吉祥物外观固定为「低负担」态，不再随安全分切换姿态、光环或装饰。 */
export function useMascotState(_score: number): MascotVisualState {
  return "low";
}
