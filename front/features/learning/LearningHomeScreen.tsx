import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "@/features/auth";
import { ApiError } from "@/shared/api";
import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";

import { learningApi } from "./api";
import { LearningCasesPanel } from "./components/LearningCasesPanel";
import { LearningHomePanel } from "./components/LearningHomePanel";
import type {
  LearningCaseCategoryKey,
  LearningCaseFeedItem,
  LearningCasesFeed,
  LearningTopicKey,
  LearningTopicSummary,
} from "./types";

const DEFAULT_TOPIC: LearningTopicKey = "financial_fraud";
const DEFAULT_CASE_CATEGORY: LearningCaseCategoryKey = "recommended";

const MEERKAT_TEACHER = require("../../assets/images/meerkat_teacher.png");

type LearningMode = "cases" | "study";

function formatHeaderTime(value?: string | null) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${date.getMonth() + 1}-${date.getDate()} ${hour}:${minute}`;
}

function getErrorText(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}

export default function LearningHomeScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ mode?: string | string[]; topic?: string | string[] }>();
  const { user } = useAuth();

  const modeMascotFloat = useSharedValue(0);
  const modeMascotFloatStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: modeMascotFloat.value }],
  }));

  const [mode, setMode] = useState<LearningMode>("study");
  const [topics, setTopics] = useState<LearningTopicSummary[]>([]);
  const [activeTopicKey, setActiveTopicKey] = useState<LearningTopicKey>(DEFAULT_TOPIC);
  const [caseFeed, setCaseFeed] = useState<LearningCasesFeed | null>(null);
  const [activeCaseCategory, setActiveCaseCategory] =
    useState<LearningCaseCategoryKey>(DEFAULT_CASE_CATEGORY);
  const [topicsLoading, setTopicsLoading] = useState(true);
  const [casesLoading, setCasesLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [topicsError, setTopicsError] = useState<string | null>(null);
  const [casesError, setCasesError] = useState<string | null>(null);

  const loadTopics = useCallback(
    async (options?: { topic?: LearningTopicKey | null; silent?: boolean }) => {
      if (!options?.silent) {
        setTopicsLoading(true);
      }

      setTopicsError(null);

      try {
        const response = await learningApi.topics({
          topic: options?.topic ?? activeTopicKey,
          role: user?.role ?? null,
        });
        setTopics(response.topics);
        setActiveTopicKey(response.current_topic.key);
      } catch (error) {
        setTopicsError(getErrorText(error, "学习专题加载失败"));
      } finally {
        if (!options?.silent) {
          setTopicsLoading(false);
        }
      }
    },
    [activeTopicKey, user?.role]
  );

  const loadCases = useCallback(
    async (category: LearningCaseCategoryKey, options?: { silent?: boolean }) => {
      if (!options?.silent) {
        setCasesLoading(true);
      }

      setCasesError(null);

      try {
        const response = await learningApi.casesFeed({
          category,
          role: user?.role ?? null,
          limit: 12,
        });
        setCaseFeed(response);
        setActiveCaseCategory(response.current_category);
      } catch (error) {
        setCasesError(getErrorText(error, "案例加载失败"));
      } finally {
        if (!options?.silent) {
          setCasesLoading(false);
        }
      }
    },
    [user?.role]
  );

  useEffect(() => {
    void loadTopics();
  }, [loadTopics]);

  useEffect(() => {
    modeMascotFloat.value = withRepeat(
      withTiming(-16, { duration: 2200, easing: Easing.inOut(Easing.sin) }),
      -1,
      true
    );
  }, [modeMascotFloat]);

  useEffect(() => {
    void loadCases(activeCaseCategory);
  }, [activeCaseCategory, loadCases]);

  useEffect(() => {
    const modeParam = Array.isArray(params.mode) ? params.mode[0] : params.mode;
    const topicParam = Array.isArray(params.topic) ? params.topic[0] : params.topic;

    if (modeParam === "cases" || modeParam === "study") {
      setMode(modeParam);
    } else if (topicParam) {
      setMode("study");
    }

    if (
      topicParam === "financial_fraud" ||
      topicParam === "social_fraud" ||
      topicParam === "impersonation_fraud" ||
      topicParam === "transaction_fraud" ||
      topicParam === "job_fraud" ||
      topicParam === "livelihood_fraud" ||
      topicParam === "other_fraud"
    ) {
      setActiveTopicKey(topicParam);
    }
  }, [params.mode, params.topic]);

  const activeTopic = useMemo(
    () => topics.find((item) => item.key === activeTopicKey) ?? topics[0] ?? null,
    [activeTopicKey, topics]
  );

  const headerMeta = useMemo(() => {
    if (mode === "study") {
      if (!activeTopic) {
        return topicsLoading ? "专题加载中" : "暂无题目";
      }
      return `${activeTopic.label} · ${activeTopic.quiz_count}题`;
    }

    if (!caseFeed) {
      return casesLoading ? "案例加载中" : "暂无案例";
    }

    const syncText = formatHeaderTime(caseFeed.last_sync_at);
    return syncText ? `${caseFeed.total}案 · ${syncText}` : `${caseFeed.total}案`;
  }, [activeTopic, caseFeed, casesLoading, mode, topicsLoading]);

  const visibleError = mode === "study" ? topicsError : casesError;

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        loadTopics({ topic: activeTopic?.key ?? activeTopicKey, silent: true }),
        loadCases(activeCaseCategory, { silent: true }),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [activeCaseCategory, activeTopic?.key, activeTopicKey, loadCases, loadTopics]);

  const handleOpenQuiz = useCallback(() => {
    if (!activeTopic) {
      return;
    }
    router.push({ pathname: "/learning/quiz", params: { topic: activeTopic.key } } as never);
  }, [activeTopic, router]);

  const handleOpenSimulation = useCallback(() => {
    if (!activeTopic) {
      return;
    }
    router.push({ pathname: "/learning/simulation", params: { topic: activeTopic.key } } as never);
  }, [activeTopic, router]);

  const handleOpenCase = useCallback(
    (item: LearningCaseFeedItem) => {
      router.push({ pathname: "/cases/[id]", params: { id: item.id } } as never);
    },
    [router]
  );

  const showLoading =
    (mode === "study" && topicsLoading && !activeTopic) ||
    (mode === "cases" && casesLoading && !caseFeed);

  return (
    <View style={styles.root}>
      <View style={styles.backgroundOrbTop} />
      <View style={styles.backgroundOrbBottom} />

      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        {showLoading ? (
          <View style={styles.centerWrap}>
            <ActivityIndicator color={palette.accentStrong} />
          </View>
        ) : (
          <ScrollView
            contentInsetAdjustmentBehavior="automatic"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.content}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => void handleRefresh()}
                tintColor={palette.accentStrong}
              />
            }
          >
            <View style={styles.header}>
              <View style={styles.headerTopRow}>
                <View style={styles.headerCopy}>
                  <Text style={styles.pageTitle}>反诈学习</Text>
                  <Text style={styles.pageMeta}>{headerMeta}</Text>
                </View>

                <Pressable
                  style={({ pressed }) => [
                    styles.jumpButton,
                    pressed && styles.buttonPressed,
                  ]}
                  onPress={() => setMode((current) => (current === "study" ? "cases" : "study"))}
                >
                  <Text style={styles.jumpButtonText}>{mode === "study" ? "看案例" : "去学习"}</Text>
                </Pressable>
              </View>

              <View style={styles.modeSwitch}>
                {([
                  { key: "cases", label: "案例" },
                  { key: "study", label: "学习" },
                ] as const).map((item) => {
                  const active = item.key === mode;
                  return (
                    <Pressable
                      key={item.key}
                      style={({ pressed }) => [
                        styles.modeButton,
                        active && styles.modeButtonActive,
                        pressed && styles.buttonPressed,
                      ]}
                      onPress={() => setMode(item.key)}
                    >
                      <Text style={[styles.modeButtonText, active && styles.modeButtonTextActive]}>
                        {item.label}
                      </Text>
                    </Pressable>
                  );
                })}
                <Animated.View
                  style={[styles.modeMascotLayer, modeMascotFloatStyle]}
                  pointerEvents="none"
                >
                  <Image
                    source={MEERKAT_TEACHER}
                    style={styles.modeMascotImage}
                    resizeMode="contain"
                    accessibilityLabel="教学狐獴"
                  />
                </Animated.View>
              </View>
            </View>

            {visibleError ? (
              <View style={styles.errorCard}>
                <Text style={styles.errorTitle}>加载失败</Text>
                <Text style={styles.errorText}>{visibleError}</Text>
                <Pressable
                  style={({ pressed }) => [
                    styles.retryButton,
                    pressed && styles.buttonPressed,
                  ]}
                  onPress={() =>
                    void (mode === "study"
                      ? loadTopics({ topic: activeTopic?.key ?? activeTopicKey })
                      : loadCases(activeCaseCategory))
                  }
                >
                  <Text style={styles.retryButtonText}>重试</Text>
                </Pressable>
              </View>
            ) : null}

            {mode === "study" ? (
              activeTopic ? (
                <LearningHomePanel
                  topics={topics}
                  activeTopic={activeTopic}
                  onChangeTopic={setActiveTopicKey}
                  onOpenQuiz={handleOpenQuiz}
                  onOpenSimulation={handleOpenSimulation}
                />
              ) : (
                <View style={styles.emptyCard}>
                  <Text style={styles.emptyTitle}>暂无题目</Text>
                </View>
              )
            ) : caseFeed ? (
              <LearningCasesPanel
                categories={caseFeed.categories}
                value={activeCaseCategory}
                items={caseFeed.items}
                loading={casesLoading}
                onChangeCategory={setActiveCaseCategory}
                onOpenCase={handleOpenCase}
              />
            ) : (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>暂无案例</Text>
              </View>
            )}
          </ScrollView>
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: palette.background,
  },
  safeArea: {
    flex: 1,
  },
  backgroundOrbTop: {
    position: "absolute",
    top: -86,
    left: -44,
    width: 214,
    height: 214,
    borderRadius: 999,
    backgroundColor: "rgba(117, 167, 255, 0.14)",
  },
  backgroundOrbBottom: {
    position: "absolute",
    right: -92,
    bottom: 104,
    width: 244,
    height: 244,
    borderRadius: 999,
    backgroundColor: "rgba(196, 218, 255, 0.18)",
  },
  content: {
    paddingTop: 8,
    paddingBottom: 28,
    gap: 10,
  },
  centerWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  header: {
    paddingHorizontal: 16,
    gap: 12,
  },
  headerTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  pageTitle: {
    color: palette.ink,
    fontSize: 26,
    lineHeight: 32,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  pageMeta: {
    color: palette.inkSoft,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  jumpButton: {
    minHeight: 34,
    borderRadius: radius.pill,
    backgroundColor: "rgba(255,255,255,0.72)",
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  jumpButtonText: {
    color: palette.accentStrong,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  modeSwitch: {
    position: "relative",
    flexDirection: "row",
    gap: 6,
    borderRadius: radius.xl,
    backgroundColor: "rgba(255,255,255,0.66)",
    borderWidth: 1,
    borderColor: palette.line,
    padding: 5,
    overflow: "visible",
  },
  modeMascotLayer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
  },
  modeMascotImage: {
    width: 104,
    height: 104,
    marginTop: -22,
  },
  modeButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 36,
  },
  modeButtonActive: {
    backgroundColor: palette.surface,
    ...panelShadow,
  },
  modeButtonText: {
    color: palette.inkSoft,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  modeButtonTextActive: {
    color: palette.ink,
  },
  errorCard: {
    marginHorizontal: 16,
    borderRadius: radius.xl,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 10,
    ...panelShadow,
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
    fontFamily: fontFamily.body,
  },
  retryButton: {
    alignSelf: "flex-start",
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
  emptyCard: {
    marginHorizontal: 16,
    borderRadius: radius.xl,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 18,
    paddingVertical: 18,
    ...panelShadow,
  },
  emptyTitle: {
    color: palette.ink,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  buttonPressed: {
    opacity: 0.92,
  },
});
