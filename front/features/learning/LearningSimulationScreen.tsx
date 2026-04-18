import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/features/auth";
import { fontFamily, palette, radius } from "@/shared/theme";

import { learningApi } from "./api";
import type {
  LearningTopicKey,
  LearningSimulationDimension,
  LearningSimulationMessage,
  LearningSimulationResult,
  LearningSimulationSession,
} from "./types";

const FALLBACK_TOPIC: LearningTopicKey = "financial_fraud";

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

function DimensionRow({ item }: { item: LearningSimulationDimension }) {
  return (
    <View style={styles.dimensionRow}>
      <View style={styles.dimensionHead}>
        <Text style={styles.dimensionLabel}>{item.label}</Text>
        <Text style={styles.dimensionScore}>{item.score}</Text>
      </View>
      <View style={styles.dimensionTrack}>
        <View style={[styles.dimensionFill, { width: `${Math.max(8, item.score)}%` }]} />
      </View>
    </View>
  );
}

function ScenarioChip({ label }: { label: string }) {
  return (
    <View style={styles.sceneChip}>
      <Text style={styles.sceneChipText}>{label}</Text>
    </View>
  );
}

export default function LearningSimulationScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ topic?: string | string[] }>();
  const topicKey = getTopicParam(params.topic);

  const [session, setSession] = useState<LearningSimulationSession | null>(null);
  const [messages, setMessages] = useState<LearningSimulationMessage[]>([]);
  const [result, setResult] = useState<LearningSimulationResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const listRef = useRef<FlatList<LearningSimulationMessage>>(null);

  const startSession = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    setInput("");
    try {
      const response = await learningApi.startSimulation({
        topic_key: topicKey,
        user_role: user?.role ?? null,
      });
      setSession(response);
      setMessages(response.messages);
    } catch (err) {
      setError(err instanceof Error ? err.message : "模拟启动失败");
    } finally {
      setLoading(false);
    }
  }, [topicKey, user?.role]);

  useEffect(() => {
    void startSession();
  }, [startSession]);

  useEffect(() => {
    if (messages.length === 0) {
      return;
    }
    const timeout = setTimeout(() => {
      listRef.current?.scrollToEnd({ animated: true });
    }, 80);
    return () => clearTimeout(timeout);
  }, [messages]);

  const sendMessage = useCallback(async () => {
    if (!session?.session_id || sending) {
      return;
    }
    const trimmed = input.trim();
    if (!trimmed) {
      return;
    }

    setSending(true);
    setError(null);
    const nextUserMessage: LearningSimulationMessage = {
      role: "user",
      content: trimmed,
      created_at: new Date().toISOString(),
    };
    setMessages((current) => [...current, nextUserMessage]);
    setInput("");

    try {
      const response = await learningApi.sendSimulationReply(session.session_id, { message: trimmed });
      setMessages((current) => [...current, response.assistant_message]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "发送失败");
    } finally {
      setSending(false);
    }
  }, [input, sending, session?.session_id]);

  const finishSession = useCallback(async () => {
    if (!session?.session_id || finishing) {
      return;
    }
    setFinishing(true);
    setError(null);
    try {
      const response = await learningApi.finishSimulation(session.session_id);
      setResult(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : "评分失败");
    } finally {
      setFinishing(false);
    }
  }, [finishing, session?.session_id]);

  const headerMeta = useMemo(
    () =>
      session ? `${session.topic_label} · ${session.persona_label}` : "AI 模拟诈骗",
    [session]
  );
  const scenarioTags = useMemo(() => session?.scenario.tags.slice(0, 3) ?? [], [session]);

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <View style={styles.navBar}>
          <Pressable style={styles.navButton} onPress={() => router.back()}>
            <MaterialCommunityIcons name="chevron-left" size={22} color={palette.ink} />
          </Pressable>
          <Text style={styles.navTitle}>AI模拟诈骗</Text>
          <Pressable style={styles.finishButton} onPress={() => void finishSession()}>
            <Text style={styles.finishButtonText}>结束</Text>
          </Pressable>
        </View>

        <Text style={styles.headerMeta}>{headerMeta}</Text>

        {loading ? (
          <View style={styles.centerWrap}>
            <ActivityIndicator color={palette.accentStrong} />
          </View>
        ) : error && !session ? (
          <View style={styles.centerWrap}>
            <Text style={styles.errorTitle}>启动失败</Text>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable style={styles.retryButton} onPress={() => void startSession()}>
              <Text style={styles.retryButtonText}>重试</Text>
            </Pressable>
          </View>
        ) : (
          <KeyboardAvoidingView
            style={styles.body}
            behavior={Platform.select({ ios: "padding", android: "height" })}
            keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}
            enabled
          >
            <FlatList
              ref={listRef}
              data={messages}
              keyExtractor={(item, index) => `${item.role}-${index}-${item.created_at}`}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
              ListHeaderComponent={
                session ? (
                  <View style={styles.listHeader}>
                    <View style={styles.sceneCard}>
                      <View style={styles.sceneTopRow}>
                        <Text style={styles.sceneTitle}>{session.scenario.title}</Text>
                        <ScenarioChip label={session.scenario.channel} />
                      </View>
                      <Text style={styles.sceneSummary}>{session.scenario.summary}</Text>
                      <View style={styles.sceneMetaRow}>
                        <ScenarioChip label={session.scenario.hook} />
                        {scenarioTags.map((item) => (
                          <ScenarioChip key={item} label={item} />
                        ))}
                      </View>
                      {session.scenario.source_case_title ? (
                        <Text style={styles.sceneSource} numberOfLines={1}>
                          案例：{session.scenario.source_case_title}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                ) : null
              }
              renderItem={({ item }) => (
                <View
                  style={[
                    styles.messageRow,
                    item.role === "user" ? styles.messageRowUser : styles.messageRowAssistant,
                  ]}
                >
                  <View
                    style={[
                      styles.messageBubble,
                      item.role === "user" ? styles.messageBubbleUser : styles.messageBubbleAssistant,
                    ]}
                  >
                    <Text
                      style={[
                        styles.messageText,
                        item.role === "user" && styles.messageTextUser,
                      ]}
                    >
                      {item.content}
                    </Text>
                  </View>
                </View>
              )}
              contentContainerStyle={[
                styles.messageList,
                { paddingBottom: result ? 16 : Math.max(insets.bottom, 16) + 92 },
              ]}
              showsVerticalScrollIndicator={false}
              contentInsetAdjustmentBehavior="automatic"
            />

            {error && session ? <Text style={styles.inlineError}>{error}</Text> : null}

            {result ? (
              <View style={[styles.resultPanel, { paddingBottom: Math.max(insets.bottom, 16) + 4 }]}>
                <View style={styles.scoreCard}>
                  <Text style={styles.scoreValue}>{result.total_score}</Text>
                  <Text style={styles.scoreSummary}>{result.summary}</Text>
                </View>

                <View style={styles.dimensionList}>
                  {result.dimensions.map((item) => (
                    <DimensionRow key={item.key} item={item} />
                  ))}
                </View>

                <View style={styles.suggestionList}>
                  {result.suggestions.map((item, index) => (
                    <View key={`${item}-${index}`} style={styles.suggestionChip}>
                      <Text style={styles.suggestionChipText}>{item}</Text>
                    </View>
                  ))}
                </View>

                <View style={styles.actionRow}>
                  <Pressable style={styles.primaryButton} onPress={() => void startSession()}>
                    <Text style={styles.primaryButtonText}>再来一轮</Text>
                  </Pressable>
                  <Pressable
                    style={styles.secondaryButton}
                    onPress={() =>
                      router.replace(
                        {
                          pathname: "/learning/quiz",
                          params: { topic: result.topic_key },
                        } as never
                      )
                    }
                  >
                    <Text style={styles.secondaryButtonText}>去刷题</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <View style={[styles.inputBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
                <TextInput
                  value={input}
                  onChangeText={setInput}
                  placeholder="输入你的应对"
                  placeholderTextColor={palette.inkSoft}
                  style={styles.input}
                  multiline
                  maxLength={200}
                />
                <Pressable
                  style={({ pressed }) => [
                    styles.sendButton,
                    (sending || !input.trim()) && styles.sendButtonDisabled,
                    pressed && input.trim() ? styles.pressed : null,
                  ]}
                  disabled={sending || !input.trim()}
                  onPress={() => void sendMessage()}
                >
                  {sending ? (
                    <ActivityIndicator size="small" color={palette.inkInverse} />
                  ) : (
                    <MaterialCommunityIcons name="send" size={18} color={palette.inkInverse} />
                  )}
                </Pressable>
              </View>
            )}
          </KeyboardAvoidingView>
        )}

        {finishing ? (
          <View style={styles.finishingMask} pointerEvents="none">
            <ActivityIndicator color={palette.accentStrong} />
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
  finishButton: {
    minWidth: 48,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.accentSoft,
    paddingHorizontal: 12,
  },
  finishButtonText: {
    color: palette.accentStrong,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  navTitle: {
    color: palette.ink,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  headerMeta: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    fontFamily: fontFamily.body,
    paddingHorizontal: 16,
    paddingBottom: 8,
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
  body: {
    flex: 1,
  },
  listHeader: {
    paddingBottom: 14,
  },
  sceneCard: {
    borderRadius: radius.lg,
    backgroundColor: "#F7FAFE",
    borderWidth: 1,
    borderColor: "#E4ECF7",
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 10,
  },
  sceneTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  sceneTitle: {
    flex: 1,
    color: palette.ink,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  sceneSummary: {
    color: palette.inkSoft,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  sceneMetaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  sceneChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: palette.surface,
  },
  sceneChipText: {
    color: palette.accentStrong,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  sceneSource: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fontFamily.body,
  },
  messageList: {
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 12,
  },
  messageRow: {
    flexDirection: "row",
  },
  messageRowAssistant: {
    justifyContent: "flex-start",
  },
  messageRowUser: {
    justifyContent: "flex-end",
  },
  messageBubble: {
    maxWidth: "82%",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  messageBubbleAssistant: {
    backgroundColor: "#F6F8FC",
  },
  messageBubbleUser: {
    backgroundColor: palette.accentStrong,
  },
  messageText: {
    color: palette.ink,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  messageTextUser: {
    color: palette.inkInverse,
  },
  inlineError: {
    color: "#C95B70",
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fontFamily.body,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    paddingTop: 10,
    paddingHorizontal: 16,
    backgroundColor: "rgba(255,255,255,0.96)",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.line,
  },
  input: {
    flex: 1,
    minHeight: 48,
    maxHeight: 120,
    borderRadius: 22,
    backgroundColor: "#F6F8FC",
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: palette.ink,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: fontFamily.body,
  },
  sendButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.accentStrong,
  },
  sendButtonDisabled: {
    backgroundColor: palette.lineStrong,
  },
  resultPanel: {
    gap: 14,
    paddingTop: 12,
    paddingHorizontal: 16,
    backgroundColor: "rgba(255,255,255,0.98)",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.line,
  },
  scoreCard: {
    borderRadius: radius.lg,
    paddingHorizontal: 18,
    paddingVertical: 18,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    gap: 6,
  },
  scoreValue: {
    color: palette.accentStrong,
    fontSize: 42,
    lineHeight: 46,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  scoreSummary: {
    color: palette.ink,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  dimensionList: {
    gap: 10,
  },
  dimensionRow: {
    gap: 8,
  },
  dimensionHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  dimensionLabel: {
    color: palette.ink,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  dimensionScore: {
    color: palette.accentStrong,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  dimensionTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: "#EAF1FA",
    overflow: "hidden",
  },
  dimensionFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: palette.accentStrong,
  },
  suggestionList: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  suggestionChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: "#F6F8FC",
  },
  suggestionChipText: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  actionRow: {
    flexDirection: "row",
    gap: 10,
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
  secondaryButton: {
    flex: 1,
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
  finishingMask: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.24)",
  },
  pressed: {
    opacity: 0.92,
  },
});
