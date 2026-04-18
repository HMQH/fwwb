import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { ApiError, resolveApiFileUrl } from "@/shared/api";
import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";

import { casesApi } from "./api";
import type { FraudCaseDetail } from "./types";

function formatDate(value?: string | null) {
  if (!value) {
    return "--";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

function collectImageUrls(detail: FraudCaseDetail | null) {
  if (!detail) {
    return [] as string[];
  }

  const urls = [
    detail.cover_url,
    ...detail.media_assets
      .filter((item) => item.type === "image")
      .map((item) => item.url),
  ]
    .map((item) => resolveApiFileUrl(item))
    .filter((item): item is string => Boolean(item));

  return [...new Set(urls)];
}

function buildParagraphs(detail: FraudCaseDetail | null) {
  if (!detail) {
    return [] as string[];
  }

  const paragraphs = detail.detail_blocks
    .flatMap((block) => block.paragraphs)
    .map((item) => item.trim())
    .filter(Boolean);

  if (paragraphs.length) {
    return paragraphs;
  }

  return detail.summary ? [detail.summary] : [];
}

export default function CaseDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const caseId = Array.isArray(params.id) ? params.id[0] : params.id;

  const [detail, setDetail] = useState<FraudCaseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openingSource, setOpeningSource] = useState(false);

  const imageUrls = useMemo(() => collectImageUrls(detail), [detail]);
  const heroImage = imageUrls[0] ?? null;
  const paragraphs = useMemo(() => buildParagraphs(detail), [detail]);

  const loadDetail = useCallback(async () => {
    if (!caseId) {
      setError("案例不存在");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await casesApi.detail(caseId);
      setDetail(response);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "案例详情加载失败");
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  const handleOpenSource = useCallback(async () => {
    if (!detail?.source_article_url || openingSource) {
      return;
    }

    setOpeningSource(true);
    try {
      await WebBrowser.openBrowserAsync(detail.source_article_url);
    } finally {
      setOpeningSource(false);
    }
  }, [detail?.source_article_url, openingSource]);

  const handleGoTopic = useCallback(() => {
    if (!detail) {
      return;
    }

    router.replace({
      pathname: "/learning",
      params: {
        mode: "study",
        topic: detail.topic_key,
      },
    } as never);
  }, [detail, router]);

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <View style={styles.navBar}>
          <Pressable style={({ pressed }) => [styles.navButton, pressed && styles.pressed]} onPress={() => router.back()}>
            <MaterialCommunityIcons name="chevron-left" size={20} color={palette.ink} />
          </Pressable>
          <Text style={styles.navTitle}>案例详情</Text>
          <View style={styles.navPlaceholder} />
        </View>

        {loading ? (
          <View style={styles.centerWrap}>
            <ActivityIndicator color={palette.accentStrong} />
          </View>
        ) : error || !detail ? (
          <View style={styles.centerWrap}>
            <Text style={styles.errorTitle}>加载失败</Text>
            <Text style={styles.errorText}>{error ?? "案例不存在"}</Text>
            <Pressable style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]} onPress={() => void loadDetail()}>
              <Text style={styles.retryButtonText}>重试</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentInsetAdjustmentBehavior="automatic"
              contentContainerStyle={[
                styles.content,
                { paddingBottom: 112 + Math.max(insets.bottom, 12) },
              ]}
            >
              <View style={styles.headerBlock}>
                <View style={styles.tagRow}>
                  <View style={styles.topicTag}>
                    <Text style={styles.topicTagText}>{detail.topic_label}</Text>
                  </View>
                  {detail.fraud_type ? (
                    <Text style={styles.subTagText}>{detail.fraud_type}</Text>
                  ) : null}
                </View>

                <Text style={styles.title}>{detail.title}</Text>

                <View style={styles.metaRow}>
                  <Text style={styles.metaText}>{detail.source_name}</Text>
                  <Text style={styles.metaDot}>·</Text>
                  <Text style={styles.metaText}>
                    {formatDate(detail.source_published_at ?? detail.published_at)}
                  </Text>
                </View>
              </View>

              {heroImage ? (
                <View style={styles.heroImageWrap}>
                  <Image
                    source={{ uri: heroImage }}
                    style={styles.heroImage}
                    contentFit="cover"
                    transition={120}
                  />
                </View>
              ) : null}

              {detail.source_article_title ? (
                <Text style={styles.sourceTitle}>{detail.source_article_title}</Text>
              ) : null}

              <View style={styles.articleBlock}>
                {paragraphs.map((paragraph, index) => (
                  <Text key={`${detail.id}-${index}`} style={styles.paragraphText}>
                    {paragraph}
                  </Text>
                ))}
              </View>
            </ScrollView>

            <View style={[styles.footerBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
              <Pressable
                style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
                onPress={handleGoTopic}
              >
                <Text style={styles.secondaryButtonText}>去学本专题</Text>
              </Pressable>

              <Pressable
                style={({ pressed }) => [
                  styles.primaryButton,
                  openingSource && styles.buttonDisabled,
                  pressed && styles.pressed,
                ]}
                onPress={() => void handleOpenSource()}
                disabled={openingSource}
              >
                <Text style={styles.primaryButtonText}>查看官方原文</Text>
              </Pressable>
            </View>
          </>
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: palette.surface,
  },
  safeArea: {
    flex: 1,
    backgroundColor: palette.surface,
  },
  navBar: {
    height: 52,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  navButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F6F8FC",
  },
  navTitle: {
    color: palette.ink,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  navPlaceholder: {
    width: 34,
    height: 34,
  },
  centerWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    gap: 10,
  },
  errorTitle: {
    color: palette.ink,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  errorText: {
    color: palette.inkSoft,
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
    fontFamily: fontFamily.body,
  },
  retryButton: {
    borderRadius: radius.pill,
    backgroundColor: palette.accentSoft,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  retryButtonText: {
    color: palette.accentStrong,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 18,
  },
  headerBlock: {
    gap: 12,
  },
  tagRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  topicTag: {
    borderRadius: radius.pill,
    backgroundColor: palette.accentSoft,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  topicTagText: {
    color: palette.accentStrong,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  subTagText: {
    color: palette.inkSoft,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  title: {
    color: palette.ink,
    fontSize: 27,
    lineHeight: 38,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  metaText: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fontFamily.body,
  },
  metaDot: {
    color: palette.lineStrong,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fontFamily.body,
  },
  heroImageWrap: {
    borderRadius: radius.xl,
    backgroundColor: "#F5F8FC",
    padding: 10,
    overflow: "hidden",
    ...panelShadow,
  },
  heroImage: {
    width: "100%",
    aspectRatio: 1.05,
    borderRadius: radius.lg,
    backgroundColor: "#F5F8FC",
  },
  sourceTitle: {
    color: palette.ink,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "700",
    fontFamily: fontFamily.display,
  },
  articleBlock: {
    gap: 16,
  },
  paragraphText: {
    color: palette.ink,
    fontSize: 16,
    lineHeight: 29,
    fontFamily: fontFamily.body,
  },
  footerBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingTop: 12,
    paddingHorizontal: 16,
    backgroundColor: "rgba(255,255,255,0.98)",
    borderTopWidth: 1,
    borderTopColor: palette.line,
  },
  secondaryButton: {
    minWidth: 112,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.accentSoft,
  },
  secondaryButtonText: {
    color: palette.accentStrong,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  primaryButton: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.accentStrong,
  },
  primaryButtonText: {
    color: palette.inkInverse,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  pressed: {
    opacity: 0.9,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});
