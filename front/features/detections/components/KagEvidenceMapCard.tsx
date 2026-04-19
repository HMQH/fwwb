import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { StyleSheet, Text, View } from "react-native";

import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";

import { sanitizeDisplayText } from "../displayText";
import type { DetectionKagEvidenceItem, DetectionResult } from "../types";
import { getResultDetail } from "../visualization";

function getEvidenceMap(result?: DetectionResult | null): DetectionKagEvidenceItem[] {
  const detail = getResultDetail(result);
  if (!detail || detail.analysis_mode !== "deep" || !detail.kag?.enabled) {
    return [];
  }
  return (detail.kag.evidence_map ?? []).slice(0, 6);
}

function getToneMeta(tone?: string | null) {
  if (tone === "safe") {
    return {
      icon: "shield-check-outline" as const,
      soft: "#EAF9F4",
      ink: "#2E9D7F",
      edge: "#CDEEDD",
    };
  }
  if (tone === "warning") {
    return {
      icon: "vector-link" as const,
      soft: "#FFF4E8",
      ink: "#D47C3A",
      edge: "#F5D7BF",
    };
  }
  if (tone === "primary") {
    return {
      icon: "radiobox-marked" as const,
      soft: "#EEF5FF",
      ink: "#2F70E6",
      edge: "#D6E6FF",
    };
  }
  return {
    icon: "alert-circle-outline" as const,
    soft: "#FFF0EA",
    ink: "#D96A4A",
    edge: "#F4D3C8",
  };
}

export function KagEvidenceMapCard({ result }: { result?: DetectionResult | null }) {
  const items = getEvidenceMap(result);
  if (!items.length) {
    return null;
  }

  const sourceCount = {
    raw: items.filter((item) => item.source === "原文").length,
    black: items.filter((item) => item.source === "风险样本").length,
    white: items.filter((item) => item.source === "安全样本").length,
  };

  return (
    <View style={styles.card}>
      <LinearGradient
        colors={["#F8FBFF", "#EEF5FF"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.header}
      >
        <View style={styles.headerTop}>
          <View style={styles.kagBadge}>
            <MaterialCommunityIcons name="graph-outline" size={13} color="#2F70E6" />
            <Text style={styles.kagBadgeText}>三路</Text>
          </View>
          <Text style={styles.title}>证据对照</Text>
        </View>
        <View style={styles.counterRow}>
          <View style={styles.counterChip}>
            <Text style={styles.counterLabel}>原文</Text>
            <Text style={styles.counterValue}>{sourceCount.raw}</Text>
          </View>
          <View style={styles.counterChip}>
            <Text style={styles.counterLabel}>风险</Text>
            <Text style={styles.counterValue}>{sourceCount.black}</Text>
          </View>
          <View style={styles.counterChip}>
            <Text style={styles.counterLabel}>安全</Text>
            <Text style={styles.counterValue}>{sourceCount.white}</Text>
          </View>
        </View>
      </LinearGradient>

      <View style={styles.list}>
        {items.map((item) => {
          const meta = getToneMeta(item.tone);
          return (
            <View key={item.id} style={[styles.evidenceCard, { borderColor: meta.edge }]}>
              <View style={styles.evidenceTop}>
                <View style={[styles.badge, { backgroundColor: meta.soft }]}>
                  <MaterialCommunityIcons name={meta.icon} size={13} color={meta.ink} />
                  <Text style={[styles.badgeText, { color: meta.ink }]}>{sanitizeDisplayText(item.source)}</Text>
                </View>
                {item.stage ? (
                  <View style={styles.stageChip}>
                    <Text style={styles.stageChipText}>{sanitizeDisplayText(item.stage)}</Text>
                  </View>
                ) : null}
              </View>

              <Text style={styles.evidenceLabel}>{sanitizeDisplayText(item.label)}</Text>
              <Text style={styles.evidenceText}>{sanitizeDisplayText(item.text)}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.xl,
    overflow: "hidden",
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: "#D4E3FA",
    ...panelShadow,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 14,
    gap: 12,
  },
  headerTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  kagBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: radius.pill,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#D8E6FC",
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  kagBadgeText: {
    color: "#2F70E6",
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  title: {
    color: palette.ink,
    fontSize: 19,
    lineHeight: 24,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  counterRow: {
    flexDirection: "row",
    gap: 10,
  },
  counterChip: {
    flex: 1,
    borderRadius: radius.md,
    backgroundColor: "rgba(255,255,255,0.76)",
    borderWidth: 1,
    borderColor: "#DCE8FA",
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4,
  },
  counterLabel: {
    color: palette.inkSoft,
    fontSize: 11,
    lineHeight: 14,
    fontFamily: fontFamily.body,
  },
  counterValue: {
    color: palette.ink,
    fontSize: 20,
    lineHeight: 24,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  list: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 18,
    gap: 12,
  },
  evidenceCard: {
    borderRadius: radius.lg,
    backgroundColor: "#FCFDFF",
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 10,
  },
  evidenceTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  badgeText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  stageChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: "#EEF5FF",
  },
  stageChipText: {
    color: "#2F70E6",
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  evidenceLabel: {
    color: palette.ink,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  evidenceText: {
    color: palette.ink,
    fontSize: 13,
    lineHeight: 19,
    fontFamily: fontFamily.body,
  },
});
