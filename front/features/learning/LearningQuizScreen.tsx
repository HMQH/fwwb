import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/features/auth";
import { homeApi } from "@/features/home/api";
import { fontFamily, palette, radius } from "@/shared/theme";

import { learningApi } from "./api";
import type { LearningQuizQuestion, LearningQuizSet, LearningTopicKey } from "./types";

const FALLBACK_TOPIC: LearningTopicKey = "financial_fraud";

function formatScore(correctCount: number, total: number) {
  if (total <= 0) {
    return 0;
  }
  return Math.round((correctCount / total) * 100);
}

function getTopicParam(value?: string | string[]): LearningTopicKey {
  const resolved = Array.isArray(value) ? value[0] : value;
  if (
    resolved === "financial_fraud" ||
    resolved === "social_fraud" ||
    resolved === "impersonation_fraud" ||
    resolved === "transaction_fraud" ||
    resolved === "job_fraud" ||
    resolved === "livelihood_fraud" ||
    resolved === "other_fraud"
  ) {
    return resolved;
  }
  return FALLBACK_TOPIC;
}

function ResultChip({ label }: { label: string }) {
  return (
    <View style={styles.resultChip}>
      <Text style={styles.resultChipText}>{label}</Text>
    </View>
  );
}

export default function LearningQuizScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, token } = useAuth();
  const params = useLocalSearchParams<{ topic?: string | string[] }>();
  const topicKey = getTopicParam(params.topic);

  const [quizSet, setQuizSet] = useState<LearningQuizSet | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, string>>({});
  const [rewardedThisRound, setRewardedThisRound] = useState(false);

  const fetchQuizSet = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const response = await learningApi.quizSet({
        topic: topicKey,
        count: 5,
        role: user?.role ?? null,
      });
      setQuizSet(response);
      setCurrentIndex(0);
      setSelectedAnswers({});
      setRewardedThisRound(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "题目加载失败");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [topicKey, user?.role]);

  useEffect(() => {
    void fetchQuizSet();
  }, [fetchQuizSet]);

  const questions = quizSet?.questions ?? [];
  const total = questions.length;
  const currentQuestion = questions[currentIndex] ?? null;
  const selectedAnswerId = currentQuestion ? selectedAnswers[currentQuestion.id] : undefined;
  const currentAnswered = Boolean(selectedAnswerId);

  const correctCount = useMemo(
    () => questions.filter((item) => selectedAnswers[item.id] === item.answer_id).length,
    [questions, selectedAnswers]
  );
  const completed = total > 0 && Object.keys(selectedAnswers).length >= total;
  const score = formatScore(correctCount, total);

  const wrongQuestions = useMemo(
    () =>
      questions.filter(
        (item) => selectedAnswers[item.id] && selectedAnswers[item.id] !== item.answer_id
      ),
    [questions, selectedAnswers]
  );

  useEffect(() => {
    if (!completed || rewardedThisRound || total <= 0) {
      return;
    }
    setRewardedThisRound(true);
    if (!token) {
      return;
    }
    void homeApi.grantWateringReward(
      {
        source: "quiz",
        units: 1,
      },
      token
    );
  }, [completed, rewardedThisRound, token, total]);

  const renderQuestion = (question: LearningQuizQuestion) => {
    const answerId = selectedAnswers[question.id];
    const answered = Boolean(answerId);
    return (
      <View style={styles.questionWrap}>
        <View style={styles.progressRow}>
          <Text style={styles.progressText}>
            {currentIndex + 1}/{total}
          </Text>
          <Text style={styles.progressText}>{quizSet?.topic_label ?? "专题"}</Text>
        </View>

        <Text style={styles.questionTitle}>{question.stem}</Text>

        {question.source_case_title || question.source_case_summary ? (
          <View style={styles.caseCard}>
            <Text style={styles.caseCardLabel}>参考案例</Text>
            {question.source_case_title ? (
              <Text style={styles.caseCardTitle}>{question.source_case_title}</Text>
            ) : null}
            {question.source_case_summary ? (
              <Text style={styles.caseCardBody}>{question.source_case_summary}</Text>
            ) : null}
          </View>
        ) : null}

        <View style={styles.optionList}>
          {question.options.map((option) => {
            const isSelected = answerId === option.id;
            const isCorrect = answered && question.answer_id === option.id;
            const isWrong = answered && isSelected && question.answer_id !== option.id;
            return (
              <Pressable
                key={option.id}
                style={({ pressed }) => [
                  styles.optionButton,
                  isSelected && styles.optionButtonSelected,
                  isCorrect && styles.optionButtonCorrect,
                  isWrong && styles.optionButtonWrong,
                  pressed && !answered && styles.pressed,
                ]}
                disabled={answered}
                onPress={() =>
                  setSelectedAnswers((current) => ({
                    ...current,
                    [question.id]: option.id,
                  }))
                }
              >
                <Text
                  style={[
                    styles.optionText,
                    isSelected && styles.optionTextSelected,
                    isCorrect && styles.optionTextCorrect,
                    isWrong && styles.optionTextWrong,
                  ]}
                >
                  {option.text}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {answered ? (
          <View style={styles.explanationCard}>
            <Text style={styles.explanationLabel}>
              {answerId === question.answer_id ? "答对了" : "本题提示"}
            </Text>
            <Text style={styles.explanationText}>{question.explanation}</Text>
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <View style={styles.navBar}>
          <Pressable style={styles.navButton} onPress={() => router.back()}>
            <MaterialCommunityIcons name="chevron-left" size={22} color={palette.ink} />
          </Pressable>
          <Text style={styles.navTitle}>刷题</Text>
          <View style={styles.navButtonPlaceholder} />
        </View>

        {loading ? (
          <View style={styles.centerWrap}>
            <ActivityIndicator color={palette.accentStrong} />
          </View>
        ) : error || !quizSet ? (
          <View style={styles.centerWrap}>
            <Text style={styles.errorTitle}>加载失败</Text>
            <Text style={styles.errorText}>{error ?? "当前专题暂无题目"}</Text>
            <Pressable style={styles.retryButton} onPress={() => void fetchQuizSet()}>
              <Text style={styles.retryButtonText}>重试</Text>
            </Pressable>
          </View>
        ) : completed ? (
          <ScrollView
            contentInsetAdjustmentBehavior="automatic"
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => {
                  setRefreshing(true);
                  void fetchQuizSet();
                }}
                tintColor={palette.accentStrong}
              />
            }
            contentContainerStyle={[
              styles.resultContent,
              { paddingBottom: Math.max(insets.bottom, 16) + 24 },
            ]}
          >
            <View style={styles.resultCard}>
              <Text style={styles.resultScore}>{score}</Text>
              <Text style={styles.resultLabel}>正确 {correctCount}/{total}</Text>
              <View style={styles.resultChipRow}>
                <ResultChip label={quizSet.topic_label} />
                <ResultChip label={wrongQuestions.length ? `${wrongQuestions.length} 题待补` : "本轮通过"} />
              </View>
            </View>

            {wrongQuestions.length ? (
              <View style={styles.summaryBlock}>
                <Text style={styles.summaryTitle}>补一补</Text>
                <View style={styles.summaryList}>
                  {wrongQuestions.map((item) => (
                    <View key={item.id} style={styles.summaryItem}>
                      <Text style={styles.summaryItemTitle} numberOfLines={2}>
                        {item.stem}
                      </Text>
                      <Text style={styles.summaryItemText}>{item.explanation}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}

            <Pressable style={styles.primaryButton} onPress={() => void fetchQuizSet()}>
              <Text style={styles.primaryButtonText}>再来一组</Text>
            </Pressable>

            <Pressable
              style={styles.secondaryButton}
              onPress={() =>
                router.replace(
                  {
                    pathname: "/learning/simulation",
                    params: { topic: quizSet.topic_key },
                  } as never
                )
              }
            >
              <Text style={styles.secondaryButtonText}>去模拟</Text>
            </Pressable>
          </ScrollView>
        ) : currentQuestion ? (
          <View style={styles.quizBody}>
            <ScrollView
              style={styles.quizScroll}
              contentInsetAdjustmentBehavior="automatic"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={[
                styles.quizContent,
                { paddingBottom: Math.max(insets.bottom, 16) + 100 },
              ]}
            >
              {renderQuestion(currentQuestion)}
            </ScrollView>

            <View style={[styles.footerBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
              <Pressable
                style={[
                  styles.footerPrimary,
                  !currentAnswered && styles.footerPrimaryDisabled,
                ]}
                disabled={!currentAnswered}
                onPress={() => {
                  if (currentIndex >= total - 1) {
                    return;
                  }
                  setCurrentIndex((value) => value + 1);
                }}
              >
                <Text style={styles.footerPrimaryText}>
                  {currentIndex >= total - 1 ? "查看结果" : "下一题"}
                </Text>
              </Pressable>
              {currentIndex >= total - 1 ? (
                <Pressable
                  style={[
                    styles.footerGhost,
                    !currentAnswered && styles.footerGhostDisabled,
                  ]}
                  disabled={!currentAnswered}
                  onPress={() => setCurrentIndex(total)}
                >
                  <Text style={styles.footerGhostText}>完成</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : null}
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
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F6F8FC",
  },
  navButtonPlaceholder: {
    width: 36,
    height: 36,
  },
  navTitle: {
    color: palette.ink,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  centerWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: 24,
  },
  errorTitle: {
    color: palette.ink,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  errorText: {
    color: palette.inkSoft,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fontFamily.body,
    textAlign: "center",
  },
  retryButton: {
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radius.pill,
    backgroundColor: palette.accentSoft,
  },
  retryButtonText: {
    color: palette.accentStrong,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  quizBody: {
    flex: 1,
  },
  quizScroll: {
    flex: 1,
  },
  quizContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  questionWrap: {
    gap: 16,
  },
  progressRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  progressText: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  questionTitle: {
    color: palette.ink,
    fontSize: 24,
    lineHeight: 32,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  caseCard: {
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: radius.md,
    backgroundColor: "#F0F5FB",
    borderWidth: 1,
    borderColor: palette.line,
  },
  caseCardLabel: {
    color: palette.accentStrong,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  caseCardTitle: {
    color: palette.ink,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  caseCardBody: {
    color: palette.inkSoft,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: fontFamily.body,
  },
  optionList: {
    gap: 12,
  },
  optionButton: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.surface,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  optionButtonSelected: {
    borderColor: palette.accentStrong,
    backgroundColor: palette.accentSoft,
  },
  optionButtonCorrect: {
    borderColor: palette.accentStrong,
    backgroundColor: palette.accentSoft,
  },
  optionButtonWrong: {
    borderColor: "#F2BAC3",
    backgroundColor: "#FFF4F6",
  },
  optionText: {
    color: palette.ink,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  optionTextSelected: {
    color: palette.accentStrong,
  },
  optionTextCorrect: {
    color: palette.accentStrong,
  },
  optionTextWrong: {
    color: "#C95B70",
  },
  explanationCard: {
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: radius.md,
    backgroundColor: "#F5F8FC",
    gap: 6,
  },
  explanationLabel: {
    color: palette.accentStrong,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  explanationText: {
    color: palette.ink,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
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
    backgroundColor: "rgba(255,255,255,0.96)",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.line,
  },
  footerPrimary: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.accentStrong,
  },
  footerPrimaryDisabled: {
    backgroundColor: palette.lineStrong,
  },
  footerPrimaryText: {
    color: palette.inkInverse,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  footerGhost: {
    width: 72,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.accentSoft,
  },
  footerGhostDisabled: {
    backgroundColor: "#EEF3FA",
  },
  footerGhostText: {
    color: palette.accentStrong,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  resultContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 16,
  },
  resultCard: {
    borderRadius: radius.lg,
    paddingHorizontal: 18,
    paddingVertical: 22,
    gap: 12,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
  },
  resultScore: {
    color: palette.accentStrong,
    fontSize: 48,
    lineHeight: 52,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  resultLabel: {
    color: palette.ink,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  resultChipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  resultChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: palette.surfaceSoft,
  },
  resultChipText: {
    color: palette.inkSoft,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  summaryBlock: {
    gap: 12,
  },
  summaryTitle: {
    color: palette.ink,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  summaryList: {
    gap: 10,
  },
  summaryItem: {
    borderRadius: radius.md,
    backgroundColor: "#F6F8FC",
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 6,
  },
  summaryItemTitle: {
    color: palette.ink,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  summaryItemText: {
    color: palette.inkSoft,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  primaryButton: {
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
  secondaryButton: {
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.accentSoft,
  },
  secondaryButtonText: {
    color: palette.accentStrong,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  pressed: {
    opacity: 0.9,
  },
});
