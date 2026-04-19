import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useMemo, useRef, useState } from "react";
import {
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";

import { navigateAudioInsightBack, useAudioScamInsightSnapshot } from "../audioScamInsightStore";
import type { ScamStageSlice, ScamTimelineMarker } from "../types";

type DetailMode = "stage" | "moment";

const STAGE_TONES = [
  { accent: "#3C8DFF", soft: "#EEF6FF", line: "#CFE4FF" },
  { accent: "#1EB7B0", soft: "#ECFBF9", line: "#BFECE8" },
  { accent: "#8B67F6", soft: "#F4F0FF", line: "#DDD1FF" },
  { accent: "#F1B53B", soft: "#FFF8E8", line: "#F7E0A8" },
  { accent: "#F08239", soft: "#FFF1E8", line: "#F7CCAE" },
  { accent: "#E44F4F", soft: "#FFEDED", line: "#F7C0C0" },
] as const;

function formatClock(value: number) {
  const totalSeconds = Math.max(0, Math.round(value));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function toPercent(value: number): `${number}%` {
  const safe = Math.max(0, Math.min(100, value));
  return `${safe}%`;
}

function getMomentColor(tone: string) {
  if (tone === "peak") return "#E44F4F";
  if (tone === "danger") return "#F08239";
  return "#4E88FF";
}

function buildWaveBars(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const position = index / Math.max(count - 1, 1);
    const envelope = 0.3 + 0.7 * (1 - Math.abs(position - 0.5) * 1.15);
    const jagged =
      0.06 +
      Math.abs(Math.sin(index * 0.82)) * 0.44 +
      Math.abs(Math.sin(index * 2.45)) * 0.28 +
      Math.abs(Math.cos(index * 1.63)) * 0.22;

    return Math.pow(Math.min(1, envelope * jagged), 2.2);
  });
}

const WAVE_BARS = buildWaveBars(70);

function getStageTone(index: number) {
  return STAGE_TONES[index] ?? STAGE_TONES[STAGE_TONES.length - 1];
}

export function AudioProcessTimelineScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { insight } = useAudioScamInsightSnapshot();
  const detailWidth = Math.max(width - 32, 1);

  const stageListRef = useRef<FlatList<ScamStageSlice> | null>(null);
  const momentListRef = useRef<FlatList<ScamTimelineMarker> | null>(null);

  const [detailMode, setDetailMode] = useState<DetailMode>("stage");
  const [selectedStageIndex, setSelectedStageIndex] = useState(0);
  const [selectedMomentIndex, setSelectedMomentIndex] = useState(0);

  if (!insight) {
    return (
      <View style={styles.root}>
        <SafeAreaView style={styles.safeArea} edges={["top"]}>
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <View style={styles.topBar}>
              <Pressable
                style={({ pressed }) => [styles.iconButton, pressed && styles.buttonPressed]}
                onPress={() => navigateAudioInsightBack(router)}
              >
                <MaterialCommunityIcons name="arrow-left" size={20} color={palette.ink} />
              </Pressable>
              <View style={styles.topBarCopy}>
                <Text style={styles.topBarEyebrow}>深度分析</Text>
                <Text style={styles.topBarTitle}>过程演化</Text>
              </View>
            </View>
            <View style={styles.emptyCard}>
              <MaterialCommunityIcons name="chart-line-variant" size={34} color={palette.accentStrong} />
              <Text style={styles.emptyTitle}>暂无过程演化结果</Text>
              <Text style={styles.emptyText}>请先完成一次音频深度分析，再查看阶段轨迹与关键时刻。</Text>
            </View>
          </ScrollView>
        </SafeAreaView>
      </View>
    );
  }

  const dynamics = insight.dynamics;
  const stages = dynamics.stage_sequence ?? [];
  const moments = dynamics.key_moments ?? [];
  const total = Math.max(dynamics.total_duration_sec, 1);

  const safeStageIndex = Math.max(0, Math.min(stages.length - 1, selectedStageIndex));
  const safeMomentIndex = Math.max(0, Math.min(moments.length - 1, selectedMomentIndex));
  const selectedStage = stages[safeStageIndex];
  const selectedMoment = moments[safeMomentIndex];
  const activeStageTone = getStageTone(safeStageIndex);

  const showStageDetail = detailMode === "stage" && stages.length > 0;
  const showMomentDetail = detailMode === "moment" && moments.length > 0;

  const stageRanges = useMemo(
    () =>
      stages.map((stage, index) => ({
        index,
        start: stage.start_sec,
        end: stage.end_sec,
      })),
    [stages]
  );

  const onStagePress = (index: number) => {
    if (!stages.length) return;
    setDetailMode("stage");
    setSelectedStageIndex(index);
    stageListRef.current?.scrollToIndex({ index, animated: true });
  };

  const onMomentPress = (index: number) => {
    if (!moments.length) return;
    setDetailMode("moment");
    setSelectedMomentIndex(index);
    momentListRef.current?.scrollToIndex({ index, animated: true });
  };

  const handleStageMomentumEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!stages.length) return;
    const nextIndex = Math.round(event.nativeEvent.contentOffset.x / detailWidth);
    setSelectedStageIndex(Math.max(0, Math.min(stages.length - 1, nextIndex)));
  };

  const handleMomentMomentumEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!moments.length) return;
    const nextIndex = Math.round(event.nativeEvent.contentOffset.x / detailWidth);
    setSelectedMomentIndex(Math.max(0, Math.min(moments.length - 1, nextIndex)));
  };

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.topBar}>
            <Pressable
              style={({ pressed }) => [styles.iconButton, pressed && styles.buttonPressed]}
              onPress={() => navigateAudioInsightBack(router)}
            >
              <MaterialCommunityIcons name="arrow-left" size={20} color={palette.ink} />
            </Pressable>
            <View style={styles.topBarCopy}>
              <Text style={styles.topBarEyebrow}>深度分析</Text>
              <Text style={styles.topBarTitle}>过程演化</Text>
            </View>
          </View>

          <View style={styles.waveCard}>
            <View style={styles.waveHeader}>
              <Text style={styles.waveTitle}>通话过程演化图谱</Text>
              <Text style={styles.waveMeta}>{formatClock(total)} 通话总时长</Text>
            </View>

            <View style={styles.wavePanel}>
              <View style={styles.flagLayer}>
                {moments.map((moment, index) => {
                  const color = getMomentColor(moment.tone);
                  const active = detailMode === "moment" && selectedMoment?.id === moment.id;
                  return (
                    <Pressable
                      key={moment.id}
                      style={[styles.flagTouch, { left: toPercent((moment.time_sec / total) * 100) }]}
                      onPress={() => onMomentPress(index)}
                    >
                      <View
                        style={[
                          styles.flagBadge,
                          active && {
                            backgroundColor: `${color}18`,
                            borderColor: color,
                          },
                        ]}
                      >
                        <MaterialCommunityIcons name="flag-variant" size={17} color={color} />
                      </View>
                    </Pressable>
                  );
                })}
              </View>

              <View style={styles.waveBarsRow}>
                {WAVE_BARS.map((value, index) => {
                  const centerSec = ((index + 0.5) / WAVE_BARS.length) * total;
                  const stageIndex = stageRanges.findIndex(
                    (item) => centerSec >= item.start && centerSec < item.end
                  );
                  const tone = getStageTone(Math.max(stageIndex, 0));
                  const isStageActive =
                    detailMode === "stage" &&
                    selectedStage &&
                    centerSec >= selectedStage.start_sec &&
                    centerSec <= selectedStage.end_sec;

                  return (
                    <Pressable
                      key={`${index}-${stageIndex}`}
                      onPress={() => {
                        if (stageIndex >= 0) onStagePress(stageIndex);
                      }}
                      style={[
                        styles.waveBar,
                        {
                          height: 8 + value * 168 + (isStageActive ? 8 : 0),
                          backgroundColor: tone.accent,
                          opacity: stageIndex >= 0 ? (isStageActive ? 1 : 0.5) : 0.2,
                        },
                      ]}
                    />
                  );
                })}
              </View>

              {detailMode === "moment" && selectedMoment ? (
                <View
                  pointerEvents="none"
                  style={[
                    styles.momentMarkerWrap,
                    { left: toPercent((selectedMoment.time_sec / total) * 100) },
                  ]}
                >
                  <View
                    style={[
                      styles.momentMarkerLine,
                      { backgroundColor: getMomentColor(selectedMoment.tone) },
                    ]}
                  />
                </View>
              ) : null}

              <View style={styles.timeRule}>
                <Text style={styles.timeLabel}>0:00</Text>
                <Text style={styles.timeLabel}>{formatClock(total / 2)}</Text>
                <Text style={styles.timeLabel}>{formatClock(total)}</Text>
              </View>
            </View>

            {stages.length ? (
              <View style={styles.stageChipWrap}>
                {stages.map((stage, index) => {
                  const tone = getStageTone(index);
                  const active = detailMode === "stage" && selectedStage?.id === stage.id;
                  return (
                    <Pressable
                      key={stage.id}
                      style={[
                        styles.stageChip,
                        {
                          borderColor: active ? tone.accent : palette.line,
                          backgroundColor: active ? tone.soft : palette.surface,
                        },
                      ]}
                      onPress={() => onStagePress(index)}
                    >
                      <View style={[styles.stageChipDot, { backgroundColor: tone.accent }]} />
                      <Text style={[styles.stageChipText, active && { color: tone.accent }]}>{stage.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <Text style={styles.noDataText}>当前结果未返回阶段轨迹。</Text>
            )}
          </View>

          <View style={styles.detailWrap}>
            <View style={styles.switchRow}>
              <Pressable
                style={[
                  styles.switchPill,
                  detailMode === "stage" && {
                    backgroundColor: activeStageTone.soft,
                    borderColor: activeStageTone.accent,
                  },
                  !stages.length && styles.switchDisabled,
                ]}
                onPress={() => stages.length && setDetailMode("stage")}
              >
                <Text
                  style={[
                    styles.switchText,
                    detailMode === "stage" && { color: activeStageTone.accent },
                  ]}
                >
                  阶段轨迹
                </Text>
              </Pressable>
              <Pressable
                style={[
                  styles.switchPill,
                  detailMode === "moment" && selectedMoment
                    ? {
                        backgroundColor: `${getMomentColor(selectedMoment.tone)}12`,
                        borderColor: getMomentColor(selectedMoment.tone),
                      }
                    : null,
                  !moments.length && styles.switchDisabled,
                ]}
                onPress={() => moments.length && setDetailMode("moment")}
              >
                <Text
                  style={[
                    styles.switchText,
                    detailMode === "moment" && selectedMoment
                      ? { color: getMomentColor(selectedMoment.tone) }
                      : null,
                  ]}
                >
                  关键时刻
                </Text>
              </Pressable>
            </View>

            {showStageDetail ? (
              <FlatList
                ref={stageListRef}
                horizontal
                pagingEnabled
                data={stages}
                keyExtractor={(item) => item.id}
                showsHorizontalScrollIndicator={false}
                bounces={false}
                disableIntervalMomentum
                decelerationRate="fast"
                renderItem={({ item, index }) => {
                  const tone = getStageTone(index);
                  return (
                    <View
                      style={[
                        styles.detailCard,
                        {
                          width: detailWidth,
                          backgroundColor: tone.soft,
                          borderColor: tone.line,
                        },
                      ]}
                    >
                      <View style={styles.detailHeader}>
                        <View style={styles.detailHeaderLeft}>
                          <View
                            style={[
                              styles.detailIconWrap,
                              {
                                backgroundColor: `${tone.accent}16`,
                                borderColor: `${tone.accent}2E`,
                              },
                            ]}
                          >
                            <MaterialCommunityIcons name="timeline-text-outline" size={18} color={tone.accent} />
                          </View>
                          <View style={styles.detailTitleWrap}>
                            <Text style={styles.detailTitle}>{item.label}</Text>
                            <Text style={styles.detailTime}>
                              {formatClock(item.start_sec)} - {formatClock(item.end_sec)}
                            </Text>
                          </View>
                        </View>
                        <View style={[styles.riskBadge, { backgroundColor: `${tone.accent}12` }]}>
                          <Text style={[styles.riskBadgeText, { color: tone.accent }]}>风险 {Math.round((item.risk_score ?? 0) * 100)}</Text>
                        </View>
                      </View>

                      <View style={[styles.summaryPanel, { borderColor: `${tone.accent}2A` }]}>
                        <Text style={[styles.summaryPanelTitle, { color: tone.accent }]}>阶段摘要</Text>
                        <Text style={styles.summaryPanelText}>{item.summary || "暂无阶段摘要"}</Text>
                      </View>

                      <View style={styles.metricPanelRow}>
                        <View style={styles.metricPanel}>
                          <Text style={styles.metricPanelLabel}>阶段占比</Text>
                          <Text style={styles.metricPanelValue}>
                            {Math.round(((item.end_sec - item.start_sec) / total) * 100)}%
                          </Text>
                        </View>
                        <View style={styles.metricPanel}>
                          <Text style={styles.metricPanelLabel}>风险分值</Text>
                          <Text style={[styles.metricPanelValue, { color: tone.accent }]}>
                            {Math.round((item.risk_score ?? 0) * 100)}
                          </Text>
                        </View>
                      </View>

                      <View style={styles.tagWrap}>
                        {(item.cue_tags ?? []).map((tag) => (
                          <View key={`${item.id}-${tag}`} style={[styles.tagChip, { backgroundColor: `${tone.accent}12` }]}>
                            <Text style={[styles.tagChipText, { color: tone.accent }]}>{tag}</Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  );
                }}
                getItemLayout={(_, index) => ({
                  length: detailWidth,
                  offset: detailWidth * index,
                  index,
                })}
                onMomentumScrollEnd={handleStageMomentumEnd}
              />
            ) : showMomentDetail ? (
              <FlatList
                ref={momentListRef}
                horizontal
                pagingEnabled
                data={moments}
                keyExtractor={(item) => item.id}
                showsHorizontalScrollIndicator={false}
                bounces={false}
                disableIntervalMomentum
                decelerationRate="fast"
                renderItem={({ item }) => {
                  const color = getMomentColor(item.tone);
                  return (
                    <View
                      style={[
                        styles.detailCard,
                        {
                          width: detailWidth,
                          backgroundColor: `${color}10`,
                          borderColor: `${color}28`,
                        },
                      ]}
                    >
                      <View style={styles.detailHeader}>
                        <View style={styles.detailHeaderLeft}>
                          <View
                            style={[
                              styles.detailIconWrap,
                              {
                                backgroundColor: `${color}18`,
                                borderColor: `${color}35`,
                              },
                            ]}
                          >
                            <MaterialCommunityIcons name="flag-variant" size={18} color={color} />
                          </View>
                          <View style={styles.detailTitleWrap}>
                            <Text style={styles.detailTitle}>{item.label}</Text>
                            <Text style={styles.detailTime}>{formatClock(item.time_sec)}</Text>
                          </View>
                        </View>
                        <View style={[styles.riskBadge, { backgroundColor: `${color}18` }]}>
                          <Text style={[styles.riskBadgeText, { color }]}>{item.stage_label || "关键节点"}</Text>
                        </View>
                      </View>

                      <View style={[styles.summaryPanel, { borderColor: `${color}2A` }]}>
                        <Text style={[styles.summaryPanelTitle, { color }]}>事件说明</Text>
                        <Text style={styles.summaryPanelText}>{item.description || "暂无说明"}</Text>
                      </View>

                      <View
                        style={[
                          styles.meaningPanel,
                          {
                            borderColor: `${color}24`,
                            backgroundColor: `${color}0E`,
                          },
                        ]}
                      >
                        <Text style={[styles.meaningLabel, { color }]}>用户意义</Text>
                        <Text style={styles.meaningText}>{item.user_meaning || "暂无补充说明"}</Text>
                      </View>
                    </View>
                  );
                }}
                getItemLayout={(_, index) => ({
                  length: detailWidth,
                  offset: detailWidth * index,
                  index,
                })}
                onMomentumScrollEnd={handleMomentMomentumEnd}
              />
            ) : (
              <View style={styles.emptyDetailCard}>
                <MaterialCommunityIcons name="information-outline" size={26} color={palette.accentStrong} />
                <Text style={styles.emptyDetailTitle}>当前结果缺少可展示的结构化轨迹</Text>
                <Text style={styles.emptyDetailText}>后端已返回基础分析结果，但阶段轨迹或关键时刻数组为空。</Text>
              </View>
            )}

            {(showStageDetail ? stages : showMomentDetail ? moments : []).length ? (
              <View style={styles.paginationRow}>
                {(showStageDetail ? stages : moments).map((item, index) => {
                  const active = showStageDetail ? index === safeStageIndex : index === safeMomentIndex;
                  return <View key={item.id} style={[styles.paginationDot, active && styles.paginationDotActive]} />;
                })}
              </View>
            ) : null}
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.background },
  safeArea: { flex: 1 },
  content: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 24,
    gap: 14,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
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
  waveCard: {
    borderRadius: 30,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 14,
    ...panelShadow,
  },
  waveHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  waveTitle: {
    color: palette.ink,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  waveMeta: {
    color: palette.accentStrong,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  wavePanel: {
    height: 246,
    borderRadius: 26,
    backgroundColor: "#F9FBFF",
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 10,
    paddingTop: 18,
    paddingBottom: 16,
    justifyContent: "space-between",
    position: "relative",
    overflow: "hidden",
  },
  flagLayer: {
    height: 34,
    position: "relative",
  },
  flagTouch: {
    position: "absolute",
    marginLeft: -14,
    alignItems: "center",
    zIndex: 3,
  },
  flagBadge: {
    width: 28,
    height: 28,
    borderRadius: 12,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    alignItems: "center",
    justifyContent: "center",
    ...panelShadow,
  },
  waveBarsRow: {
    height: 156,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 2,
  },
  waveBar: {
    flex: 1,
    borderRadius: radius.pill,
  },
  momentMarkerWrap: {
    position: "absolute",
    top: 44,
    bottom: 30,
    marginLeft: -1,
    width: 2,
    alignItems: "center",
    zIndex: 2,
  },
  momentMarkerLine: {
    width: 2,
    height: "100%",
    borderRadius: radius.pill,
    opacity: 0.9,
  },
  timeRule: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 2,
  },
  timeLabel: {
    color: palette.inkSoft,
    fontSize: 11,
    lineHeight: 14,
    fontFamily: fontFamily.body,
  },
  stageChipWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  stageChip: {
    minWidth: "31%",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderWidth: 1,
  },
  stageChipDot: {
    width: 8,
    height: 8,
    borderRadius: radius.pill,
  },
  stageChipText: {
    flex: 1,
    color: palette.ink,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  noDataText: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  detailWrap: {
    gap: 10,
  },
  switchRow: {
    flexDirection: "row",
    gap: 8,
  },
  switchPill: {
    flex: 1,
    borderRadius: radius.pill,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  switchDisabled: {
    opacity: 0.45,
  },
  switchText: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  detailCard: {
    borderRadius: 28,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 18,
    gap: 14,
    ...panelShadow,
  },
  detailHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  detailHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  detailIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  detailTitleWrap: {
    flex: 1,
    gap: 2,
  },
  detailTitle: {
    color: palette.ink,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  detailTime: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fontFamily.body,
  },
  riskBadge: {
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  riskBadgeText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  summaryPanel: {
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.72)",
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 6,
  },
  summaryPanelTitle: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  summaryPanelText: {
    color: palette.ink,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: fontFamily.body,
  },
  metricPanelRow: {
    flexDirection: "row",
    gap: 10,
  },
  metricPanel: {
    flex: 1,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.8)",
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 6,
  },
  metricPanelLabel: {
    color: palette.inkSoft,
    fontSize: 11,
    lineHeight: 14,
    fontFamily: fontFamily.body,
  },
  metricPanelValue: {
    color: palette.ink,
    fontSize: 18,
    lineHeight: 22,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  tagWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  tagChip: {
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  tagChipText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  meaningPanel: {
    borderRadius: 22,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 6,
  },
  meaningLabel: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  meaningText: {
    color: palette.ink,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: fontFamily.body,
  },
  paginationRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  paginationDot: {
    width: 8,
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: palette.lineStrong,
  },
  paginationDotActive: {
    width: 22,
    backgroundColor: palette.accentStrong,
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
  emptyDetailCard: {
    borderRadius: 28,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 20,
    paddingVertical: 28,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    ...panelShadow,
  },
  emptyDetailTitle: {
    color: palette.ink,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "900",
    textAlign: "center",
    fontFamily: fontFamily.display,
  },
  emptyDetailText: {
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
