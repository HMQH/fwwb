import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";

import { useAuth } from "@/features/auth";
import { ApiError } from "@/shared/api";
import { fontFamily, palette, radius } from "@/shared/theme";
import { TaskPrimaryButton, TaskScreen } from "@/shared/ui/TaskScreen";

import { detectionsApi } from "../api";
import { SimilarImageGalleryCard } from "../components/SimilarImageGalleryCard";
import type {
  DirectImageSkillCheckResponse,
  DirectSkillEvidence,
  PickedFile,
  SimilarImageItem,
} from "../types";

type DirectImageSkillKey =
  | "ocr"
  | "official-document"
  | "pii"
  | "qr"
  | "impersonation";

type ScreenConfig = {
  title: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  tint: string;
  soft: string;
};

const screenConfigMap: Record<DirectImageSkillKey, ScreenConfig> = {
  ocr: {
    title: "OCR话术识别",
    icon: "text-recognition",
    tint: "#3388FF",
    soft: "#ECF4FF",
  },
  "official-document": {
    title: "公章仿造检测",
    icon: "file-document-outline",
    tint: "#F08C38",
    soft: "#FFF3E8",
  },
  pii: {
    title: "敏感信息检测",
    icon: "shield-key-outline",
    tint: "#E05C86",
    soft: "#FFF0F5",
  },
  qr: {
    title: "二维码URL检测",
    icon: "qrcode-scan",
    tint: "#5B6CFF",
    soft: "#EEF1FF",
  },
  impersonation: {
    title: "网图识别",
    icon: "image-filter-center-focus-weak",
    tint: "#7A63F6",
    soft: "#F3EEFF",
  },
};

type PickedImage = PickedFile & {
  width?: number;
  height?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toFiniteNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatPercent(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "--";
  }
  return `${Math.round(value * 100)}%`;
}

function resolveRiskMeta(result: DirectImageSkillCheckResponse | null) {
  if (!result) {
    return { label: "未检测", tint: palette.inkSoft, soft: palette.surfaceSoft };
  }

  const score = Number(result.result.risk_score || 0);
  if (score >= 0.75) {
    return { label: "高风险", tint: "#D9485F", soft: "#FFF0F0" };
  }
  if (score >= 0.45) {
    return { label: "中风险", tint: "#D68910", soft: "#FFF7E8" };
  }
  if (result.result.triggered) {
    return { label: "可疑", tint: "#7A63F6", soft: "#F2EEFF" };
  }
  return { label: "低风险", tint: "#2F70E6", soft: "#EAF2FF" };
}

function normalizeSimilarImageItem(item: unknown, index: number, validated = false): SimilarImageItem | null {
  if (!isRecord(item)) {
    return null;
  }

  const title = typeof item.title === "string" ? item.title.trim() : "";
  const sourceUrl = typeof item.source_url === "string" ? item.source_url.trim() : "";
  const imageUrl = typeof item.image_url === "string" ? item.image_url.trim() : "";
  const thumbnailUrl = typeof item.thumbnail_url === "string" ? item.thumbnail_url.trim() : "";
  const domain = typeof item.domain === "string" ? item.domain.trim() : "";
  const provider = typeof item.provider === "string" ? item.provider.trim() : "";
  const matchType = typeof item.match_type === "string" ? item.match_type.trim() : "";

  if (!title && !sourceUrl && !imageUrl && !thumbnailUrl && !domain) {
    return null;
  }

  const fallbackKey = sourceUrl || imageUrl || thumbnailUrl || domain || "similar-image";
  const rawId = typeof item.id === "string" ? item.id.trim() : "";

  return {
    id: rawId || `${fallbackKey}-${index + 1}`,
    title: title || null,
    source_url: sourceUrl || null,
    image_url: imageUrl || null,
    thumbnail_url: thumbnailUrl || imageUrl || null,
    domain: domain || null,
    provider: provider || null,
    match_type: matchType || null,
    is_validated: (typeof item.is_validated === "boolean" ? item.is_validated : undefined) || validated,
    clip_similarity: toFiniteNumber(item.clip_similarity),
    hash_similarity: toFiniteNumber(item.hash_similarity),
    phash_distance: toFiniteNumber(item.phash_distance),
    dhash_distance: toFiniteNumber(item.dhash_distance),
    hash_near_duplicate: typeof item.hash_near_duplicate === "boolean" ? item.hash_near_duplicate : undefined,
    clip_high_similarity: typeof item.clip_high_similarity === "boolean" ? item.clip_high_similarity : undefined,
  };
}

function isImageEvidence(item: DirectSkillEvidence) {
  const extra = isRecord(item.extra) ? item.extra : null;
  return Boolean(extra && (extra.source_url || extra.image_url || extra.thumbnail_url));
}

function getDirectSimilarImages(result: DirectImageSkillCheckResponse | null) {
  if (!result) {
    return [] as SimilarImageItem[];
  }

  const raw = isRecord(result.result.raw) ? result.result.raw : null;
  const validation = raw && isRecord(raw.similarity_validation) ? raw.similarity_validation : null;
  const validatedMatches = Array.isArray(validation?.validated_matches) ? validation.validated_matches : [];
  const rawMatches = Array.isArray(raw?.matches) ? raw.matches : [];
  const evidenceExtras = Array.isArray(result.result.evidence)
    ? result.result.evidence
        .map((item) => {
          const extra = isRecord(item.extra) ? item.extra : null;
          if (!extra) {
            return null;
          }
          return {
            ...extra,
            title: typeof extra.title === "string" && extra.title.trim() ? extra.title : item.title,
          };
        })
        .filter(Boolean)
    : [];

  const seen = new Set<string>();
  const items: SimilarImageItem[] = [];

  const pushItems = (sourceItems: unknown[], validated = false) => {
    sourceItems.forEach((item, index) => {
      const normalized = normalizeSimilarImageItem(item, index, validated);
      if (!normalized) {
        return;
      }
      const dedupeKey = normalized.source_url ?? normalized.image_url ?? normalized.thumbnail_url ?? normalized.id;
      if (seen.has(dedupeKey)) {
        return;
      }
      seen.add(dedupeKey);
      items.push(normalized);
    });
  };

  pushItems(validatedMatches, true);
  pushItems(rawMatches, false);
  pushItems(evidenceExtras, false);

  return items.sort((left, right) => {
    const leftPriority = Number(Boolean(left.is_validated || left.hash_near_duplicate || left.clip_high_similarity));
    const rightPriority = Number(Boolean(right.is_validated || right.hash_near_duplicate || right.clip_high_similarity));
    if (leftPriority !== rightPriority) {
      return rightPriority - leftPriority;
    }
    const clipGap = (right.clip_similarity ?? -1) - (left.clip_similarity ?? -1);
    if (clipGap !== 0) {
      return clipGap;
    }
    return (right.hash_similarity ?? -1) - (left.hash_similarity ?? -1);
  });
}

async function runCheck(
  token: string,
  skill: DirectImageSkillKey,
  imageFile: PickedFile,
) {
  switch (skill) {
    case "ocr":
      return detectionsApi.checkOcrPhishing(token, imageFile);
    case "official-document":
      return detectionsApi.checkOfficialDocument(token, imageFile);
    case "pii":
      return detectionsApi.checkPii(token, imageFile);
    case "qr":
      return detectionsApi.checkQr(token, imageFile);
    case "impersonation":
      return detectionsApi.checkImpersonation(token, imageFile);
  }
}

export function DirectImageSkillScreen({
  skill,
}: {
  skill: DirectImageSkillKey;
}) {
  const router = useRouter();
  const { token } = useAuth();
  const config = screenConfigMap[skill];
  const [pickedImage, setPickedImage] = useState<PickedImage | null>(null);
  const [result, setResult] = useState<DirectImageSkillCheckResponse | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const riskMeta = useMemo(() => resolveRiskMeta(result), [result]);
  const similarImages = useMemo(() => getDirectSimilarImages(result), [result]);
  const visibleEvidence = useMemo(
    () => (result?.result.evidence || []).filter((item) => !isImageEvidence(item)),
    [result],
  );

  const pickImage = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("需要相册权限", "请先允许访问相册");
      return;
    }

    const response = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: false,
      quality: 0.95,
    });

    if (response.canceled || !response.assets.length) {
      return;
    }

    const asset = response.assets[0];
    setResult(null);
    setPickedImage({
      uri: asset.uri,
      name: asset.fileName ?? `${skill}-${Date.now()}.jpg`,
      type: asset.mimeType ?? "image/jpeg",
      width: asset.width,
      height: asset.height,
    });
  }, [skill]);

  const handleSubmit = useCallback(async () => {
    if (!pickedImage) {
      void pickImage();
      return;
    }
    if (!token) {
      Alert.alert("未登录", "请先登录");
      return;
    }

    setSubmitting(true);
    try {
      const next = await runCheck(token, skill, pickedImage);
      if (next.submission_id) {
        router.replace({
          pathname: "/records/[id]",
          params: { id: next.submission_id },
        });
        return;
      }
      setResult(next);
    } catch (error) {
      const message =
        error instanceof ApiError ? error.message : "专项检测失败";
      Alert.alert("检测失败", message);
    } finally {
      setSubmitting(false);
    }
  }, [pickImage, pickedImage, router, skill, token]);

  const buttonLabel = useMemo(() => {
    if (!pickedImage) {
      return "上传图片";
    }
    if (result) {
      return "重新上传";
    }
    return "开始检测";
  }, [pickedImage, result]);

  return (
    <TaskScreen
      title={config.title}
      footer={
        <TaskPrimaryButton
          label={buttonLabel}
          onPress={() => {
            if (!pickedImage || result) {
              void pickImage();
              return;
            }
            void handleSubmit();
          }}
          loading={submitting}
        />
      }
    >
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.headRow}>
          <View style={[styles.iconWrap, { backgroundColor: config.soft }]}>
            <MaterialCommunityIcons
              name={config.icon}
              size={22}
              color={config.tint}
            />
          </View>
          <View style={styles.headCopy}>
            <Text style={styles.headTitle}>{config.title}</Text>
            <Text style={styles.headMeta}>专项检测</Text>
          </View>
        </View>

        <View style={styles.previewWrap}>
          {pickedImage ? (
            <Image
              source={{ uri: pickedImage.uri }}
              style={styles.previewImage}
              contentFit="cover"
            />
          ) : (
            <View style={styles.previewEmpty}>
              <MaterialCommunityIcons
                name="image-outline"
                size={28}
                color={palette.inkSoft}
              />
              <Text style={styles.previewEmptyText}>上传图片后显示在这里</Text>
            </View>
          )}
        </View>

        <View style={styles.resultCard}>
          <View style={[styles.statusBadge, { backgroundColor: riskMeta.soft }]}>
            <Text style={[styles.statusBadgeText, { color: riskMeta.tint }]}>
              {riskMeta.label}
            </Text>
          </View>

          <View style={styles.metricRow}>
            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>风险评分</Text>
              <Text style={styles.metricValue}>
                {formatPercent(result?.result.risk_score)}
              </Text>
            </View>
            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>命中线索</Text>
              <Text style={styles.metricValue}>
                {result ? String(result.result.evidence.length) : "--"}
              </Text>
            </View>
          </View>

          <Text style={styles.summaryText}>
            {result?.result.summary || "检测结果会显示在这里"}
          </Text>

          {visibleEvidence.length ? (
            <View style={styles.evidenceList}>
              {visibleEvidence.map((item, index) => (
                <View key={`${item.title}-${index}`} style={styles.evidenceRow}>
                  <Text style={styles.evidenceTitle} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text style={styles.evidenceDetail} numberOfLines={2}>
                    {item.detail}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>

        {similarImages.length ? (
          <SimilarImageGalleryCard items={similarImages} title="发现图片" />
        ) : null}
      </ScrollView>
    </TaskScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 16,
    paddingBottom: 6,
  },
  headRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  headCopy: {
    flex: 1,
    gap: 4,
  },
  headTitle: {
    color: palette.ink,
    fontSize: 19,
    lineHeight: 24,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  headMeta: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 17,
    fontFamily: fontFamily.body,
  },
  previewWrap: {
    height: 220,
    borderRadius: radius.md,
    overflow: "hidden",
    backgroundColor: palette.surfaceSoft,
    borderWidth: 1,
    borderColor: palette.line,
  },
  previewImage: {
    width: "100%",
    height: "100%",
  },
  previewEmpty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  previewEmptyText: {
    color: palette.inkSoft,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  resultCard: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.surfaceSoft,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 12,
  },
  statusBadge: {
    alignSelf: "flex-start",
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  statusBadgeText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  metricRow: {
    flexDirection: "row",
    gap: 10,
  },
  metricCard: {
    flex: 1,
    borderRadius: radius.md,
    backgroundColor: palette.surface,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 4,
  },
  metricLabel: {
    color: palette.inkSoft,
    fontSize: 11,
    lineHeight: 15,
    fontFamily: fontFamily.body,
  },
  metricValue: {
    color: palette.ink,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  summaryText: {
    color: palette.ink,
    fontSize: 13,
    lineHeight: 19,
    fontFamily: fontFamily.body,
  },
  evidenceList: {
    gap: 8,
  },
  evidenceRow: {
    borderRadius: radius.md,
    backgroundColor: palette.surface,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 3,
  },
  evidenceTitle: {
    color: palette.ink,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  evidenceDetail: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 17,
    fontFamily: fontFamily.body,
  },
});
