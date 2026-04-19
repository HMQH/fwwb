import { MaterialCommunityIcons } from "@expo/vector-icons";
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";

import { navigateAudioInsightBack, useAudioScamInsightSnapshot } from "../audioScamInsightStore";
import type { ScamEvidenceSegment } from "../types";

function formatClock(value: number) {
  const totalSeconds = Math.max(0, Math.round(value));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function riskTone(score: number) {
  if (score >= 0.9) return { soft: "#FFF0ED", line: "#FFD9D1", ink: "#D95D55" };
  if (score >= 0.75) return { soft: "#FFF6EA", line: "#F7DEB9", ink: "#DF8C3A" };
  return { soft: "#EDF4FF", line: "#D6E6FF", ink: palette.accentStrong };
}

const PLAYER_WAVE = [
  0.36, 0.58, 0.44, 0.68, 0.5, 0.74, 0.52, 0.4, 0.64, 0.48, 0.7, 0.42, 0.62,
  0.45, 0.66, 0.54, 0.76, 0.46, 0.68, 0.38, 0.56, 0.48, 0.7, 0.52,
];

const CLIP_SEEK_RETRY_DELAY_MS = 180;

const TAG_LABEL_MAP: Record<string, string> = {
  calm_tone: "平稳语气",
  urgent_tone: "紧迫语气",
  pressure_tone: "施压语气",
  command_tone: "命令语气",
  dominant_speech: "主导发言",
  repeated_emphasis: "反复强调",
  high_pressure_speech: "高压输出",
  sustained_pressure: "持续施压",
  reassuring_language: "安抚性话术",
  directive_language: "指令性话术",
  imperative_language: "命令式表达",
  identity_claim: "身份背书",
  identity_disguise: "身份伪装",
  trust_building: "信任建立",
  trust_warming: "信任铺垫",
  benefit_inducement: "利益诱导",
  fake_solution: "虚假方案",
  process_simplification: "流程简化",
  link_introduction: "链接引导",
  action_guidance: "行为引导",
  operation_guidance: "操作引导",
  information_request: "信息索取",
  psychological_suggestion: "心理暗示",
  information_blocking: "信息封锁",
  security_emphasis: "安全强调",
  step_confirmation: "步骤确认",
  risk_induction: "风险诱导",
  control_isolation: "控制隔离",
};

const TAG_TOKEN_MAP: Record<string, string> = {
  calm: "平稳",
  urgent: "紧迫",
  pressure: "施压",
  command: "命令",
  dominant: "主导",
  repeated: "反复",
  emphasis: "强调",
  high: "高",
  sustained: "持续",
  speech: "发言",
  tone: "语气",
  reassuring: "安抚",
  directive: "指令性",
  imperative: "命令式",
  language: "话术",
  identity: "身份",
  claim: "背书",
  disguise: "伪装",
  trust: "信任",
  building: "建立",
  warming: "铺垫",
  benefit: "利益",
  inducement: "诱导",
  fake: "虚假",
  solution: "方案",
  process: "流程",
  simplification: "简化",
  link: "链接",
  introduction: "引导",
  action: "行为",
  operation: "操作",
  guidance: "引导",
  information: "信息",
  request: "索取",
  psychological: "心理",
  suggestion: "暗示",
  security: "安全",
  step: "步骤",
  confirmation: "确认",
  risk: "风险",
  control: "控制",
  isolation: "隔离",
};

function translateTag(tag: string) {
  const normalized = tag.trim().toLowerCase();
  if (!normalized) return "未识别标签";
  if (TAG_LABEL_MAP[normalized]) return TAG_LABEL_MAP[normalized];

  const parts = normalized.split(/[_-]+/).filter(Boolean);
  const translated = parts.map((part) => TAG_TOKEN_MAP[part] ?? part);
  const hasChinese = translated.some((part) => /[一-鿿]/.test(part));

  if (hasChinese) {
    return translated.join("");
  }
  return tag;
}

export function AudioEvidenceSegmentsScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const listRef = useRef<FlatList<ScamEvidenceSegment> | null>(null);
  const { insight, sourceAudioUri } = useAudioScamInsightSnapshot();
  const player = useAudioPlayer(null, { updateInterval: 150, keepAudioSessionActive: true });
  const playerStatus = useAudioPlayerStatus(player);

  const [activeIndex, setActiveIndex] = useState(0);
  const [playerIndex, setPlayerIndex] = useState(0);
  const [clipPlaying, setClipPlaying] = useState(false);
  const [isPreparingClip, setIsPreparingClip] = useState(false);
  const [clipError, setClipError] = useState<string | null>(null);

  const segments = insight?.evidence_segments ?? [];
  const pageWidth = Math.max(width - 32, 1);
  const activeSegment = segments[Math.max(0, Math.min(segments.length - 1, activeIndex))];
  const playerSegment = segments[Math.max(0, Math.min(segments.length - 1, playerIndex))];

  const clipDurationSec = useMemo(
    () => Math.max((playerSegment?.end_sec ?? 1) - (playerSegment?.start_sec ?? 0), 1),
    [playerSegment?.end_sec, playerSegment?.start_sec]
  );

  const clipElapsedSec = useMemo(() => {
    if (!playerSegment) return 0;
    const currentTime = playerStatus.currentTime ?? 0;
    return Math.max(0, Math.min(clipDurationSec, currentTime - playerSegment.start_sec));
  }, [clipDurationSec, playerSegment, playerStatus.currentTime]);

  const progress = clipDurationSec > 0 ? clipElapsedSec / clipDurationSec : 0;

  useEffect(() => {
    void setAudioModeAsync({
      playsInSilentMode: true,
      allowsRecording: false,
      shouldPlayInBackground: false,
      interruptionMode: "mixWithOthers",
    });
  }, []);

  useEffect(() => {
    return () => {
      try {
        player.pause();
      } catch {
        // ignore cleanup errors
      }
    };
  }, [player]);

  useEffect(() => {
    if (!clipPlaying || !playerSegment) return;

    const currentTime = playerStatus.currentTime ?? 0;
    if (playerStatus.didJustFinish || currentTime >= playerSegment.end_sec) {
      player.pause();
      void player.seekTo(playerSegment.start_sec).catch(() => undefined);
      setClipPlaying(false);
    }
  }, [clipPlaying, player, playerSegment, playerStatus.currentTime, playerStatus.didJustFinish]);

  if (!insight) {
    return (
      <View style={styles.root}>
        <SafeAreaView style={styles.safeArea} edges={["top"]}>
          <View style={styles.content}>
            <View style={styles.topBar}>
              <Pressable
                style={({ pressed }) => [styles.iconButton, pressed && styles.buttonPressed]}
                onPress={() => navigateAudioInsightBack(router)}
              >
                <MaterialCommunityIcons name="arrow-left" size={20} color={palette.ink} />
              </Pressable>
              <View style={styles.topBarCopy}>
                <Text style={styles.topBarEyebrow}>关键证据</Text>
                <Text style={styles.topBarTitle}>证据片段</Text>
              </View>
            </View>
            <View style={styles.emptyCard}>
              <MaterialCommunityIcons name="file-document-multiple-outline" size={34} color={palette.accentStrong} />
              <Text style={styles.emptyTitle}>暂无分析结果</Text>
              <Text style={styles.emptyText}>请先完成音频深度分析，再查看关键证据片段。</Text>
            </View>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  if (!segments.length) {
    return (
      <View style={styles.root}>
        <SafeAreaView style={styles.safeArea} edges={["top"]}>
          <View style={styles.content}>
            <View style={styles.topBar}>
              <Pressable
                style={({ pressed }) => [styles.iconButton, pressed && styles.buttonPressed]}
                onPress={() => navigateAudioInsightBack(router)}
              >
                <MaterialCommunityIcons name="arrow-left" size={20} color={palette.ink} />
              </Pressable>
              <View style={styles.topBarCopy}>
                <Text style={styles.topBarEyebrow}>关键证据</Text>
                <Text style={styles.topBarTitle}>证据片段</Text>
              </View>
            </View>
            <View style={styles.emptyCard}>
              <MaterialCommunityIcons name="file-search-outline" size={34} color={palette.accentStrong} />
              <Text style={styles.emptyTitle}>暂无证据片段</Text>
              <Text style={styles.emptyText}>当前分析结果里还没有可展示的证据片段。</Text>
            </View>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  async function startClipPlayback(index: number) {
    if (!sourceAudioUri) {
      Alert.alert("无法播放", "当前没有可用的原始音频文件，无法播放对应证据片段。");
      return;
    }

    const segment = segments[index];
    if (!segment) return;

    setPlayerIndex(index);
    setActiveIndex(index);
    setIsPreparingClip(true);
    setClipError(null);
    setClipPlaying(false);

    try {
      player.pause();
      player.replace({ uri: sourceAudioUri });

      try {
        await player.seekTo(Math.max(0, segment.start_sec));
      } catch {
        await new Promise((resolve) => setTimeout(resolve, CLIP_SEEK_RETRY_DELAY_MS));
        await player.seekTo(Math.max(0, segment.start_sec));
      }

      player.play();
      setClipPlaying(true);
    } catch (error) {
      console.error("evidence clip playback failed", error);
      setClipError("证据片段播放失败，请稍后重试。");
      Alert.alert("播放失败", "暂时无法播放该证据片段，请确认音频文件仍可访问后重试。");
    } finally {
      setIsPreparingClip(false);
    }
  }

  async function toggleCurrentClipPlayback() {
    if (!playerSegment) return;

    if (!sourceAudioUri) {
      Alert.alert("无法播放", "当前没有可用的原始音频文件，无法播放对应证据片段。");
      return;
    }

    if (clipPlaying && playerStatus.playing) {
      player.pause();
      setClipPlaying(false);
      return;
    }

    const currentTime = playerStatus.currentTime ?? 0;
    const insideCurrentClip = currentTime >= playerSegment.start_sec && currentTime < playerSegment.end_sec;

    if (!playerStatus.isLoaded || !insideCurrentClip) {
      await startClipPlayback(playerIndex);
      return;
    }

    player.play();
    setClipPlaying(true);
  }

  const tone = riskTone(activeSegment?.risk_score ?? 0);

  const handleMomentumEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const nextIndex = Math.round(event.nativeEvent.contentOffset.x / pageWidth);
    const safeIndex = Math.max(0, Math.min(segments.length - 1, nextIndex));
    setActiveIndex(safeIndex);
    setPlayerIndex(safeIndex);
    setClipPlaying(false);
    try {
      player.pause();
    } catch {
      // ignore pause errors
    }
  };

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <View style={styles.content}>
          <View style={styles.topBar}>
            <Pressable
              style={({ pressed }) => [styles.iconButton, pressed && styles.buttonPressed]}
              onPress={() => navigateAudioInsightBack(router)}
            >
              <MaterialCommunityIcons name="arrow-left" size={20} color={palette.ink} />
            </Pressable>
            <View style={styles.topBarCopy}>
              <Text style={styles.topBarEyebrow}>关键证据</Text>
              <Text style={styles.topBarTitle}>证据片段</Text>
            </View>
          </View>

          <View style={styles.playerCard}>
            <View style={styles.playerHeader}>
              <View style={styles.playerHeaderLeft}>
                <View style={[styles.playerAccent, { backgroundColor: `${tone.ink}18` }]}>
                  <MaterialCommunityIcons name="waveform" size={20} color={tone.ink} />
                </View>
                <View>
                  <Text style={styles.playerTitle}>{playerSegment.stage_label}</Text>
                  <Text style={styles.playerMeta}>
                    {formatClock(playerSegment.start_sec)} - {formatClock(playerSegment.end_sec)}
                  </Text>
                </View>
              </View>
              <Pressable
                style={({ pressed }) => [styles.playCircle, pressed && styles.buttonPressed]}
                onPress={() => void toggleCurrentClipPlayback()}
                disabled={isPreparingClip}
              >
                {isPreparingClip ? (
                  <ActivityIndicator size="small" color={palette.inkInverse} />
                ) : (
                  <MaterialCommunityIcons
                    name={clipPlaying && playerStatus.playing ? "pause" : "play"}
                    size={20}
                    color={palette.inkInverse}
                  />
                )}
              </Pressable>
            </View>

            <Text style={styles.playerQuote}>
              {playerSegment.transcript_excerpt || "当前片段暂无可展示的转写文本。"}
            </Text>

            <View style={styles.fakeWaveTrack}>
              {PLAYER_WAVE.map((height, index) => (
                <View
                  key={`${index}-${height}`}
                  style={[
                    styles.fakeWaveBar,
                    {
                      height: 10 + height * 28,
                      backgroundColor: index / PLAYER_WAVE.length <= progress ? tone.ink : "#D8E6FA",
                    },
                  ]}
                />
              ))}
            </View>

            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${progress * 100}%`, backgroundColor: tone.ink }]} />
            </View>

            <View style={styles.progressMeta}>
              <Text style={styles.progressText}>{clipElapsedSec.toFixed(1)}s</Text>
              <Text style={styles.progressText}>{clipDurationSec.toFixed(1)}s</Text>
            </View>

            {clipError ? <Text style={styles.errorText}>{clipError}</Text> : null}
            {!sourceAudioUri ? <Text style={styles.helperText}>当前会话没有保留原始音频地址，因此只能查看文本证据，无法试听片段。</Text> : null}
          </View>

          <View style={styles.carouselSection}>
            <FlatList
              ref={listRef}
              horizontal
              pagingEnabled
              data={segments}
              keyExtractor={(item) => item.id}
              showsHorizontalScrollIndicator={false}
              bounces={false}
              disableIntervalMomentum
              decelerationRate="fast"
              snapToAlignment="start"
              renderItem={({ item, index }) => {
                const itemTone = riskTone(item.risk_score);
                return (
                  <View style={[styles.page, { width: pageWidth }]}>
                    <View
                      style={[
                        styles.segmentCard,
                        {
                          backgroundColor: itemTone.soft,
                          borderColor: itemTone.line,
                        },
                      ]}
                    >
                      <View style={styles.segmentHeader}>
                        <View style={styles.segmentHeaderLeft}>
                          <View style={[styles.indexBadge, { backgroundColor: itemTone.ink }]}>
                            <Text style={styles.indexBadgeText}>{index + 1}</Text>
                          </View>
                          <View style={styles.segmentTitleWrap}>
                            <Text style={styles.segmentTitle}>{item.stage_label}</Text>
                            <Text style={styles.segmentTime}>
                              {formatClock(item.start_sec)} - {formatClock(item.end_sec)}
                            </Text>
                          </View>
                        </View>
                        <View style={[styles.riskPill, { backgroundColor: `${itemTone.ink}15` }]}>
                          <Text style={[styles.riskPillText, { color: itemTone.ink }]}>风险 {Math.round(item.risk_score * 100)}</Text>
                        </View>
                      </View>

                      <View style={styles.quoteCard}>
                        <Text style={styles.segmentQuote}>
                          {item.transcript_excerpt ? `“${item.transcript_excerpt}”` : "当前片段暂无可展示的转写文本。"}
                        </Text>
                      </View>

                      <View style={styles.tagWrap}>
                        {item.audio_tags.slice(0, 2).map((tag, tagIndex) => (
                          <View key={`${item.id}-audio-${tagIndex}-${tag}`} style={styles.audioTag}>
                            <Text style={styles.audioTagText}>{translateTag(tag)}</Text>
                          </View>
                        ))}
                        {item.semantic_tags.slice(0, 2).map((tag, tagIndex) => (
                          <View key={`${item.id}-semantic-${tagIndex}-${tag}`} style={styles.semanticTag}>
                            <Text style={styles.semanticTagText}>{translateTag(tag)}</Text>
                          </View>
                        ))}
                      </View>

                      <View style={styles.reasonCard}>
                        <Text style={styles.reasonLabel}>判定依据</Text>
                        <Text style={styles.segmentReason} numberOfLines={3}>
                          {item.explanation || "暂无说明"}
                        </Text>
                      </View>

                      <Pressable
                        style={({ pressed }) => [styles.previewButton, pressed && styles.buttonPressed]}
                        onPress={() => void startClipPlayback(index)}
                      >
                        <MaterialCommunityIcons name="play-circle-outline" size={18} color={palette.accentStrong} />
                        <Text style={styles.previewButtonText}>播放相应片段</Text>
                      </Pressable>
                    </View>
                  </View>
                );
              }}
              getItemLayout={(_, index) => ({
                length: pageWidth,
                offset: pageWidth * index,
                index,
              })}
              onMomentumScrollEnd={handleMomentumEnd}
            />

            <View style={styles.paginationRow}>
              {segments.map((segment, index) => (
                <Pressable
                  key={segment.id}
                  style={[
                    styles.paginationDot,
                    index === activeIndex && {
                      width: 22,
                      backgroundColor: tone.ink,
                    },
                  ]}
                  onPress={() => {
                    listRef.current?.scrollToIndex({ index, animated: true });
                    setActiveIndex(index);
                    setPlayerIndex(index);
                    setClipPlaying(false);
                    try {
                      player.pause();
                    } catch {
                      // ignore pause errors
                    }
                  }}
                />
              ))}
            </View>
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.background },
  safeArea: { flex: 1 },
  content: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 18,
    gap: 14,
  },
  topBar: { flexDirection: "row", alignItems: "center", gap: 12 },
  iconButton: {
    width: 42,
    height: 42,
    borderRadius: 16,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    alignItems: "center",
    justifyContent: "center",
    ...panelShadow,
  },
  topBarCopy: { flex: 1, gap: 2 },
  topBarEyebrow: {
    color: palette.accentStrong,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  topBarTitle: {
    color: palette.ink,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  playerCard: {
    borderRadius: 30,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 18,
    paddingVertical: 18,
    gap: 14,
    ...panelShadow,
  },
  playerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  playerHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  playerAccent: {
    width: 42,
    height: 42,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  playerTitle: {
    color: palette.ink,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  playerMeta: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fontFamily.body,
  },
  playCircle: {
    width: 46,
    height: 46,
    borderRadius: radius.pill,
    backgroundColor: palette.accentStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  playerQuote: {
    color: palette.ink,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  fakeWaveTrack: {
    height: 42,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 4,
  },
  fakeWaveBar: {
    flex: 1,
    borderRadius: radius.pill,
  },
  progressTrack: {
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: palette.surfaceSoft,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: radius.pill,
  },
  progressMeta: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  progressText: {
    color: palette.inkSoft,
    fontSize: 11,
    lineHeight: 14,
    fontFamily: fontFamily.body,
  },
  errorText: {
    color: palette.danger ?? "#C94B44",
    fontSize: 12,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  helperText: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  carouselSection: {
    flex: 1,
    gap: 12,
  },
  page: {
    flex: 1,
  },
  segmentCard: {
    flex: 1,
    borderRadius: 28,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 12,
    ...panelShadow,
  },
  segmentHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  segmentHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  segmentTitleWrap: {
    flex: 1,
  },
  indexBadge: {
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  indexBadgeText: {
    color: palette.white,
    fontSize: 12,
    lineHeight: 14,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  segmentTitle: {
    color: palette.ink,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  segmentTime: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fontFamily.body,
  },
  riskPill: {
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  riskPillText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  quoteCard: {
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.72)",
    borderWidth: 1,
    borderColor: "rgba(214,228,250,0.9)",
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 2,
  },
  segmentQuote: {
    color: palette.ink,
    fontSize: 14,
    lineHeight: 22,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  tagWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  audioTag: {
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "rgba(47,112,230,0.10)",
  },
  audioTagText: {
    color: palette.accentStrong,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  semanticTag: {
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "rgba(225,112,82,0.12)",
  },
  semanticTagText: {
    color: "#D77453",
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  reasonCard: {
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.66)",
    borderWidth: 1,
    borderColor: "rgba(214,228,250,0.92)",
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 6,
  },
  reasonLabel: {
    color: palette.accentStrong,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  segmentReason: {
    color: palette.ink,
    fontSize: 13,
    lineHeight: 19,
    fontFamily: fontFamily.body,
  },
  previewButton: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: radius.pill,
    backgroundColor: palette.surface,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: palette.line,
  },
  previewButtonText: {
    color: palette.accentStrong,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  paginationRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
  },
  paginationDot: {
    width: 8,
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: palette.lineStrong,
  },
  emptyCard: {
    marginTop: 24,
    borderRadius: 28,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 20,
    paddingVertical: 28,
    alignItems: "center",
    gap: 12,
    ...panelShadow,
  },
  emptyTitle: {
    color: palette.ink,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  emptyText: {
    color: palette.inkSoft,
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
    fontFamily: fontFamily.body,
  },
  buttonPressed: {
    transform: [{ scale: 0.98 }],
  },
});
