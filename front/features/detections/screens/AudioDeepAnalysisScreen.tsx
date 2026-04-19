import { MaterialCommunityIcons } from "@expo/vector-icons";
import type { Href } from "expo-router";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Circle, G, Line, Polygon } from "react-native-svg";

import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";

import {
  getAudioScamInsightSnapshot,
  navigateAudioInsightBack,
  useAudioScamInsightSnapshot,
} from "../audioScamInsightStore";

const RADAR_SIZE = 170;
const RADAR_CENTER = RADAR_SIZE / 2;
const RADAR_RADIUS = 54;
const RADAR_ANGLES = [-90, -18, 54, 126, 198];
const RADAR_LABELS = ["紧迫感", "控制感", "命令性", "顺从度", "压迫度"];
const RADAR_COLORS = ["#E36958", "#F1A043", "#5B8DFF", "#34B29E", "#8A67F7"];

const DONUT_SIZE = 104;
const DONUT_RADIUS = 30;
const DONUT_STROKE = 16;

function polarPoint(angleDeg: number, radiusValue: number) {
  const angle = (Math.PI / 180) * angleDeg;
  return {
    x: RADAR_CENTER + radiusValue * Math.cos(angle),
    y: RADAR_CENTER + radiusValue * Math.sin(angle),
  };
}

function polygonPoints(radiusValue: number) {
  return RADAR_ANGLES.map((angle) => polarPoint(angle, radiusValue))
    .map((point) => `${point.x},${point.y}`)
    .join(" ");
}

export function AudioDeepAnalysisScreen() {
  const router = useRouter();
  const { insight, sourceFilename } = useAudioScamInsightSnapshot();

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
                <Text style={styles.topBarEyebrow}>深度分析</Text>
                <Text style={styles.topBarTitle}>诈骗行为画像</Text>
              </View>
            </View>

            <View style={styles.emptyCard}>
              <MaterialCommunityIcons name="waveform" size={34} color={palette.accentStrong} />
              <Text style={styles.emptyTitle}>暂无分析结果</Text>
              <Text style={styles.emptyText}>
                请先完成音频深度分析，再查看整体行为画像与风险判定依据。
              </Text>
              <Pressable
                style={({ pressed }) => [styles.emptyButton, pressed && styles.buttonPressed]}
                onPress={() => {
                  const href = getAudioScamInsightSnapshot().returnHref?.trim();
                  router.replace((href ?? "/detect-audio") as Href);
                }}
              >
                <Text style={styles.emptyButtonText}>返回音频检测</Text>
              </Pressable>
            </View>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  const profile = insight.behavior_profile;
  const contribution = insight.modality_contrib;

  const radarValues = [
    profile.urgency_score,
    profile.dominance_score,
    profile.command_score,
    profile.victim_compliance_score,
    profile.speech_pressure_score,
  ].map((value) => Math.max(0, Math.min(1, value ?? 0)));

  const radarPolygon = radarValues
    .map((value, index) => polarPoint(RADAR_ANGLES[index], RADAR_RADIUS * value))
    .map((point) => `${point.x},${point.y}`)
    .join(" ");

  const compositeScore = Math.round(
    (radarValues.reduce((sum, value) => sum + value, 0) / radarValues.length) * 100
  );

  const topMetrics = [
    { label: "紧迫感", value: profile.urgency_score, color: RADAR_COLORS[0] },
    { label: "压迫度", value: profile.speech_pressure_score, color: RADAR_COLORS[4] },
    { label: "命令性", value: profile.command_score, color: RADAR_COLORS[2] },
  ];

  const contributionItems = [
    { label: "音频行为", value: contribution.audio_behavior, color: "#5B86FF" },
    { label: "文本语义", value: contribution.semantic_content, color: "#47A6F3" },
    { label: "过程演化", value: contribution.process_dynamics, color: "#F2A145" },
  ];

  const circumference = 2 * Math.PI * DONUT_RADIUS;
  let donutOffset = 0;
  const donutSegments = contributionItems.map((item) => {
    const safeValue = Math.max(0, Math.min(1, item.value ?? 0));
    const length = circumference * safeValue;
    const node = (
      <Circle
        key={item.label}
        cx={DONUT_SIZE / 2}
        cy={DONUT_SIZE / 2}
        r={DONUT_RADIUS}
        stroke={item.color}
        strokeWidth={DONUT_STROKE}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={`${length} ${circumference}`}
        strokeDashoffset={-donutOffset}
      />
    );
    donutOffset += length;
    return node;
  });

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
              <Text style={styles.topBarTitle}>诈骗行为画像</Text>
            </View>
          </View>

          <View style={styles.profileCard}>
            <View style={styles.cardHeaderRow}>
              <View style={styles.cardHeaderCopy}>
                <Text style={styles.cardTitle}>整体行为画像</Text>
                {sourceFilename ? (
                  <Text style={styles.cardCaption} numberOfLines={1}>
                    来源文件：{sourceFilename}
                  </Text>
                ) : null}
              </View>

              <View style={styles.scoreBadge}>
                <Text style={styles.scoreNumber}>{compositeScore}</Text>
                <Text style={styles.scoreLabel}>画像总分</Text>
              </View>
            </View>

            <View style={styles.chartWrap}>
              <View style={styles.chartCard}>
                <Svg width={RADAR_SIZE} height={RADAR_SIZE}>
                  {[0.25, 0.5, 0.75, 1].map((level) => (
                    <Polygon
                      key={level}
                      points={polygonPoints(RADAR_RADIUS * level)}
                      fill="transparent"
                      stroke="#D8E7FB"
                      strokeWidth={1}
                    />
                  ))}

                  {RADAR_ANGLES.map((angle, index) => {
                    const point = polarPoint(angle, RADAR_RADIUS);
                    return (
                      <Line
                        key={`line-${index}`}
                        x1={RADAR_CENTER}
                        y1={RADAR_CENTER}
                        x2={point.x}
                        y2={point.y}
                        stroke="#D8E7FB"
                        strokeWidth={1}
                      />
                    );
                  })}

                  <Polygon
                    points={radarPolygon}
                    fill="rgba(91, 134, 255, 0.20)"
                    stroke="#5B86FF"
                    strokeWidth={2}
                  />

                  {radarValues.map((value, index) => {
                    const point = polarPoint(RADAR_ANGLES[index], RADAR_RADIUS * value);
                    return (
                      <Circle
                        key={`point-${index}`}
                        cx={point.x}
                        cy={point.y}
                        r={4}
                        fill={RADAR_COLORS[index]}
                      />
                    );
                  })}
                </Svg>

                {RADAR_LABELS.map((label, index) => {
                  const point = polarPoint(RADAR_ANGLES[index], RADAR_RADIUS + 18);
                  return (
                    <View
                      key={`label-${index}`}
                      style={[
                        styles.axisLabel,
                        {
                          left: point.x - 28,
                          top: point.y - 14,
                        },
                      ]}
                    >
                      <Text style={styles.axisValue}>{Math.round(radarValues[index] * 100)}</Text>
                      <Text style={styles.axisText}>{label}</Text>
                    </View>
                  );
                })}
              </View>
            </View>

            <View style={styles.metricRow}>
              {topMetrics.map((item) => (
                <View key={item.label} style={styles.metricChip}>
                  <View style={[styles.metricDot, { backgroundColor: item.color }]} />
                  <Text style={styles.metricChipText}>
                    {item.label} {Math.round((item.value ?? 0) * 100)}
                  </Text>
                </View>
              ))}
            </View>

            <View style={styles.summaryBox}>
              <Text style={styles.summaryTitle}>分析摘要</Text>
              <Text style={styles.summaryText}>{profile.summary || "暂无摘要"}</Text>
            </View>
          </View>

          <View style={styles.contributionCard}>
            <View style={styles.contributionHeader}>
              <Text style={styles.contributionTitle}>判定依据分布</Text>
              <Text style={styles.contributionFootnote}>三个维度占比之和约为 100%</Text>
            </View>

            <View style={styles.contributionBody}>
              <View style={styles.donutWrap}>
                <Svg width={DONUT_SIZE} height={DONUT_SIZE}>
                  <G rotation="-90" origin={`${DONUT_SIZE / 2}, ${DONUT_SIZE / 2}`}>
                    <Circle
                      cx={DONUT_SIZE / 2}
                      cy={DONUT_SIZE / 2}
                      r={DONUT_RADIUS}
                      stroke="#E8F0FD"
                      strokeWidth={DONUT_STROKE}
                      fill="none"
                    />
                    {donutSegments}
                  </G>
                </Svg>
                <View style={styles.donutCenter}>
                  <Text style={styles.donutCenterValue}>100%</Text>
                  <Text style={styles.donutCenterLabel}>占比</Text>
                </View>
              </View>

              <View style={styles.legendList}>
                {contributionItems.map((item) => (
                  <View key={item.label} style={styles.legendItem}>
                    <View style={styles.legendLabelRow}>
                      <View style={[styles.legendDot, { backgroundColor: item.color }]} />
                      <Text style={styles.legendLabel}>{item.label}</Text>
                    </View>
                    <Text style={styles.legendValue}>{Math.round((item.value ?? 0) * 100)}%</Text>
                  </View>
                ))}
              </View>
            </View>
          </View>

          <View style={styles.moduleRow}>
            <Pressable
              style={({ pressed }) => [styles.moduleCard, styles.processCard, pressed && styles.buttonPressed]}
              onPress={() => router.push("/audio-process-timeline")}
            >
              <View style={styles.moduleTextWrap}>
                <Text style={styles.moduleTitle}>过程演化</Text>
                <Text style={styles.moduleMeta}>{insight.dynamics.stage_sequence.length} 个阶段</Text>
              </View>
              <View style={[styles.moduleIconBubble, { backgroundColor: "#E6EDFF" }]}>
                <MaterialCommunityIcons name="chart-line-variant" size={30} color="#3A73F0" />
              </View>
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.moduleCard, styles.evidenceCard, pressed && styles.buttonPressed]}
              onPress={() => router.push("/audio-evidence-segments")}
            >
              <View style={styles.moduleTextWrap}>
                <Text style={styles.moduleTitle}>关键证据</Text>
                <Text style={styles.moduleMeta}>{insight.evidence_segments.length} 个片段</Text>
              </View>
              <View style={[styles.moduleIconBubble, { backgroundColor: "#FFF1E3" }]}>
                <MaterialCommunityIcons name="file-document-multiple-outline" size={30} color="#F09B42" />
              </View>
            </Pressable>
          </View>
        </ScrollView>
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
  content: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 18,
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
  topBarCopy: {
    flex: 1,
    gap: 2,
  },
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
  profileCard: {
    borderRadius: 30,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 14,
    gap: 10,
    ...panelShadow,
  },
  cardHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  cardHeaderCopy: {
    flex: 1,
    gap: 4,
  },
  cardTitle: {
    color: palette.ink,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  cardCaption: {
    color: palette.inkSoft,
    fontSize: 11,
    lineHeight: 15,
    fontFamily: fontFamily.body,
  },
  scoreBadge: {
    minWidth: 72,
    borderRadius: 18,
    backgroundColor: palette.surfaceSoft,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  scoreNumber: {
    color: palette.ink,
    fontSize: 22,
    lineHeight: 24,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  scoreLabel: {
    color: palette.inkSoft,
    fontSize: 10,
    lineHeight: 12,
    fontFamily: fontFamily.body,
  },
  chartWrap: {
    alignItems: "center",
    justifyContent: "center",
  },
  chartCard: {
    width: RADAR_SIZE + 6,
    height: RADAR_SIZE + 6,
    borderRadius: 28,
    backgroundColor: "#F8FBFF",
    borderWidth: 1,
    borderColor: palette.line,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  axisLabel: {
    position: "absolute",
    width: 56,
    alignItems: "center",
    gap: 1,
  },
  axisValue: {
    color: palette.ink,
    fontSize: 13,
    lineHeight: 14,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  axisText: {
    color: palette.inkSoft,
    fontSize: 9,
    lineHeight: 11,
    fontFamily: fontFamily.body,
  },
  metricRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "center",
  },
  metricChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: radius.pill,
    backgroundColor: palette.surfaceSoft,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  metricDot: {
    width: 8,
    height: 8,
    borderRadius: radius.pill,
  },
  metricChipText: {
    color: palette.ink,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  summaryBox: {
    borderRadius: 22,
    backgroundColor: "#F8FBFF",
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 6,
  },
  summaryTitle: {
    color: palette.accentStrong,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  summaryText: {
    color: palette.ink,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: fontFamily.body,
  },
  contributionCard: {
    borderRadius: 28,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 12,
    ...panelShadow,
  },
  contributionHeader: {
    gap: 2,
  },
  contributionTitle: {
    color: palette.ink,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  contributionFootnote: {
    color: palette.inkSoft,
    fontSize: 11,
    lineHeight: 15,
    fontFamily: fontFamily.body,
  },
  contributionBody: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  donutWrap: {
    width: DONUT_SIZE,
    height: DONUT_SIZE,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  donutCenter: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
  },
  donutCenterValue: {
    color: palette.ink,
    fontSize: 18,
    lineHeight: 20,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  donutCenterLabel: {
    color: palette.inkSoft,
    fontSize: 10,
    lineHeight: 12,
    fontFamily: fontFamily.body,
  },
  legendList: {
    flex: 1,
    gap: 12,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  legendLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: radius.pill,
  },
  legendLabel: {
    color: palette.ink,
    fontSize: 13,
    lineHeight: 16,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  legendValue: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  moduleRow: {
    flexDirection: "row",
    gap: 12,
  },
  moduleCard: {
    flex: 1,
    minHeight: 126,
    borderRadius: 28,
    paddingHorizontal: 14,
    paddingVertical: 14,
    justifyContent: "space-between",
    ...panelShadow,
  },
  processCard: {
    backgroundColor: "#EEF3FF",
    borderWidth: 1,
    borderColor: "#D3E0FF",
  },
  evidenceCard: {
    backgroundColor: "#FFF3EA",
    borderWidth: 1,
    borderColor: "#FFDCC1",
  },
  moduleTextWrap: {
    gap: 2,
  },
  moduleTitle: {
    color: palette.ink,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  moduleMeta: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fontFamily.body,
  },
  moduleIconBubble: {
    alignSelf: "center",
    width: 62,
    height: 62,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#DCE8FF",
    shadowOpacity: 0.45,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
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
  emptyButton: {
    marginTop: 4,
    minHeight: 44,
    borderRadius: radius.pill,
    backgroundColor: palette.accentStrong,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyButtonText: {
    color: palette.inkInverse,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  buttonPressed: {
    transform: [{ scale: 0.98 }],
  },
});
