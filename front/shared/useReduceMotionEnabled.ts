import { AccessibilityInfo } from "react-native";
import { useEffect, useState } from "react";

export function useReduceMotionEnabled() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let mounted = true;

    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (mounted) {
        setEnabled(Boolean(value));
      }
    });

    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", (value) => {
      setEnabled(Boolean(value));
    });

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return enabled;
}
