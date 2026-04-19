import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { fontFamily, palette, radius } from "@/shared/theme";

import { sanitizeDisplayText } from "../displayText";
import type { DetectionKagPayload, DetectionKagStageRow } from "../types";

function clampPercent(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0;
  }
  const normalized = value >= 0 && value <= 1 ? value * 100 : value;
  return Math.max(0, Math.min(100, Math.round(normalized)));
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getStageTone(tone?: string | null) {
  if (tone === "danger") {
    return {
      ink: "#D96A4A",
      soft: "#FFF1EA",
      edge: "#F2D2C7",
      strong: "#F7B39D",
    };
  }
  if (tone === "warning") {
    return {
      ink: "#C98533",
      soft: "#FFF5E8",
      edge: "#F1DEC0",
      strong: "#EDC68A",
    };
  }
  if (tone === "safe") {
    return {
      ink: "#2E9D7F",
      soft: "#EAF9F4",
      edge: "#CBEBDD",
      strong: "#93D5BF",
    };
  }
  return {
    ink: "#2F70E6",
    soft: "#EEF5FF",
    edge: "#D6E5FB",
    strong: "#94BAF6",
  };
}

function buildStageRows(kag: DetectionKagPayload) {
  const rows = (
    kag.stage_rows?.length
      ? kag.stage_rows
      : (kag.stage_scores ?? []).map((item) => ({
          code: item.code,
          label: item.label,
          score: item.score,
          support_score: item.score,
          active: item.active,
          tone: item.tone,
          black_count: 0,
          white_count: 0,
        }))
  )
    .filter((item): item is DetectionKagStageRow => Boolean(item?.code && item?.label))
    .slice(0, 6);

  return rows;
}

export function DeepReasoningStageGraph({
  kag,
  height = 320,
  showPath = true,
}: {
  kag: DetectionKagPayload;
  height?: number;
  showPath?: boolean;
}) {
  const stageRows = useMemo(() => buildStageRows(kag), [kag]);
  const currentStageCode = String(kag.current_stage?.code ?? "").trim();
  const pathItems = (
    kag.trajectory?.length
      ? kag.trajectory
      : kag.reasoning_path ?? []
  )
    .map((item) => sanitizeDisplayText(String(item)))
    .filter(Boolean)
    .slice(0, 6);

  const compactHeight = clamp(height, 184, 226);

  return (
    <View style={styles.wrap}>
      <View style={[styles.board, { minHeight: compactHeight }]}>
        <View style={styles.stageZone}>
          <View style={styles.stageRailLine} />
          <View style={styles.stageRow}>
            {stageRows.map((item) => {
              const tone = getStageTone(item.tone);
              const support = clampPercent(item.support_score ?? item.score);
              const isActive = Boolean(item.active || item.code === currentStageCode);

              return (
                <View key={item.code} style={styles.stageSlot}>
                  <View style={styles.stageNodeWrap}>
                    <View
                      style={[
                        styles.stageNode,
                        {
                          backgroundColor: isActive ? tone.soft : "#FFFFFF",
                          borderColor: isActive ? tone.strong : tone.edge,
                        },
                        isActive && styles.stageNodeActive,
                      ]}
                    >
                      {isActive ? (
                        <MaterialCommunityIcons name="check" size={16} color={tone.ink} />
                      ) : (
                        <View style={[styles.stageNodeCore, { backgroundColor: tone.ink }]} />
                      )}
                    </View>
                  </View>

                  <Text style={[styles.stageLabel, isActive && styles.stageLabelActive]} numberOfLines={2}>
                    {sanitizeDisplayText(item.label)}
                  </Text>

                  <View style={styles.supportTrack}>
                    <View style={[styles.supportFill, { width: `${Math.max(12, support)}%`, backgroundColor: tone.ink }]} />
                  </View>

                  <View style={styles.stageMetaRow}>
                    <View style={[styles.countChip, styles.countChipRisk]}>
                      <Text style={[styles.countChipText, styles.countChipTextRisk]}>{item.black_count ?? 0}</Text>
                    </View>
                    <View style={[styles.countChip, styles.countChipSafe]}>
                      <Text style={[styles.countChipText, styles.countChipTextSafe]}>{item.white_count ?? 0}</Text>
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      </View>

      {showPath && pathItems.length ? (
        <View style={styles.pathRow}>
          {pathItems.map((item, index) => (
            <View key={`${item}-${index}`} style={styles.pathStep}>
              <View style={styles.pathChip}>
                <Text style={styles.pathChipText}>{item}</Text>
              </View>
              {index < pathItems.length - 1 ? (
                <MaterialCommunityIcons name="arrow-right" size={14} color={palette.inkSoft} />
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 12,
  },
  board: {
    position: "relative",
    borderRadius: radius.xl,
    backgroundColor: "#F7FAFF",
    borderWidth: 1,
    borderColor: "#DEE9F8",
    overflow: "hidden",
  },
  stageZone: {
    paddingTop: 22,
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
  stageRailLine: {
    position: "absolute",
    left: 34,
    right: 34,
    top: 44,
    height: 3,
    borderRadius: radius.pill,
    backgroundColor: "#DDE7F7",
  },
  stageRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  stageSlot: {
    flex: 1,
    alignItems: "center",
    gap: 8,
  },
  stageNodeWrap: {
    height: 44,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  stageNode: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  stageNodeActive: {
    width: 42,
    height: 42,
    borderRadius: 21,
    shadowColor: "#A7C5F4",
    shadowOpacity: 0.16,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  stageNodeCore: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  stageLabel: {
    color: "#617C9D",
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "800",
    fontFamily: fontFamily.body,
    textAlign: "center",
    minHeight: 30,
  },
  stageLabelActive: {
    color: palette.ink,
  },
  supportTrack: {
    width: "100%",
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: "#E7EEF9",
    overflow: "hidden",
  },
  supportFill: {
    height: "100%",
    borderRadius: radius.pill,
  },
  stageMetaRow: {
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
  },
  countChip: {
    minWidth: 26,
    height: 24,
    borderRadius: 12,
    paddingHorizontal: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  countChipRisk: {
    backgroundColor: "#FFF1EA",
  },
  countChipSafe: {
    backgroundColor: "#EAF9F4",
  },
  countChipText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  countChipTextRisk: {
    color: "#D96A4A",
  },
  countChipTextSafe: {
    color: "#2E9D7F",
  },
  pathRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  pathStep: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  pathChip: {
    borderRadius: radius.pill,
    backgroundColor: "#EEF5FF",
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  pathChipText: {
    color: "#244C86",
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
});
