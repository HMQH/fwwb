import { Linking, Pressable, StyleSheet, Text, View } from "react-native";

import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";

import type { DetectionEvidence } from "../types";

function openMaybe(url?: string | null) {
  if (!url) {
    return;
  }
  void Linking.openURL(url);
}

export function EvidenceListCard({
  title,
  subtitle,
  items,
  tone = "black",
}: {
  title: string;
  subtitle?: string;
  items: DetectionEvidence[];
  tone?: "black" | "white";
}) {
  const theme =
    tone === "black"
      ? { soft: "#FFF3EE", ink: "#C1664A" }
      : { soft: "#EDF6FF", ink: palette.accentStrong };

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>

      {items.length ? (
        <View style={styles.list}>
          {items.map((item) => (
            <View key={`${item.source_id}-${item.chunk_index}-${item.sample_label}`} style={styles.row}>
              <View style={styles.rowTop}>
                <View style={[styles.badge, { backgroundColor: theme.soft }]}>
                  <Text style={[styles.badgeText, { color: theme.ink }]}>
                    {item.sample_label === "black" ? "风险参照" : "安全参照"}
                  </Text>
                </View>
                <Text style={styles.scoreText}>{Math.round(item.similarity_score * 100)} 分</Text>
              </View>

              <Text style={styles.chunkText} numberOfLines={4}>
                {item.chunk_text}
              </Text>
              {item.reason ? <Text style={styles.reasonText}>{item.reason}</Text> : null}

              <View style={styles.metaRow}>
                {item.fraud_type ? <Text style={styles.metaText}>{item.fraud_type}</Text> : null}
                {item.data_source ? <Text style={styles.metaText}>{item.data_source}</Text> : null}
              </View>

              {item.url ? (
                <Pressable style={({ pressed }) => [styles.linkChip, pressed && styles.linkChipPressed]} onPress={() => openMaybe(item.url)}>
                  <Text style={styles.linkChipText} numberOfLines={1}>
                    原链
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ))}
        </View>
      ) : (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>暂无</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 14,
    ...panelShadow,
  },
  header: {
    gap: 4,
  },
  title: {
    color: palette.ink,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  subtitle: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  list: {
    gap: 12,
  },
  row: {
    borderRadius: radius.md,
    backgroundColor: palette.surfaceSoft,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 8,
  },
  rowTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  badge: {
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  badgeText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  scoreText: {
    color: palette.inkSoft,
    fontSize: 11,
    lineHeight: 14,
    fontFamily: fontFamily.body,
  },
  chunkText: {
    color: palette.ink,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: fontFamily.body,
  },
  reasonText: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  metaText: {
    color: palette.accentStrong,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  linkChip: {
    alignSelf: "flex-start",
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: palette.accentSoft,
  },
  linkChipPressed: {
    transform: [{ scale: 0.98 }],
  },
  linkChipText: {
    color: palette.accentStrong,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  emptyState: {
    borderRadius: radius.md,
    backgroundColor: palette.surfaceSoft,
    paddingHorizontal: 12,
    paddingVertical: 14,
  },
  emptyText: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
});
