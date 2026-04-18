import { useEffect } from "react";

import { useLocalSearchParams, useRouter } from "expo-router";

import { DetectionModeScreen } from "@/features/detections";

const legacyFeatureRouteMap: Record<string, string> = {
  ocr: "/detect-ocr",
  "official-document": "/detect-official-document",
  pii: "/detect-pii",
  qr: "/detect-qr",
  impersonation: "/detect-impersonation",
};

export default function DetectVisualScreen() {
  const router = useRouter();
  const { feature } = useLocalSearchParams<{ feature?: string }>();
  const normalizedFeature = (feature ?? "").trim().toLowerCase();
  const legacyRoute = legacyFeatureRouteMap[normalizedFeature];

  useEffect(() => {
    if (legacyRoute) {
      router.replace(legacyRoute as never);
    }
  }, [legacyRoute, router]);

  if (legacyRoute) {
    return null;
  }

  return <DetectionModeScreen mode="visual" />;
}
