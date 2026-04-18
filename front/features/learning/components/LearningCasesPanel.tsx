import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { resolveApiFileUrl } from "@/shared/api";
import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";

import type {
  LearningCaseCategory,
  LearningCaseCategoryKey,
  LearningCaseFeedItem,
} from "../types";
import { LearningTopicTabs } from "./LearningTopicTabs";

type Props = {
  categories: LearningCaseCategory[];
  value: LearningCaseCategoryKey;
  items: LearningCaseFeedItem[];
  loading?: boolean;
  onChangeCategory: (value: LearningCaseCategoryKey) => void;
  onOpenCase: (item: LearningCaseFeedItem) => void;
};

function formatCaseDate(value?: string | null) {
  if (!value) {
    return "--";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return `${date.getMonth() + 1}-${date.getDate()}`;
}

function buildCaseTags(item: LearningCaseFeedItem) {
  const values = [item.topic_label, item.fraud_type, ...item.tags]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));

  const unique: string[] = [];
  for (const value of values) {
    if (!unique.includes(value)) {
      unique.push(value);
    }
    if (unique.length >= 2) {
      break;
    }
  }
  return unique;
}

export function LearningCasesPanel({
  categories,
  value,
  items,
  loading,
  onChangeCategory,
  onOpenCase,
}: Props) {
  return (
    <View style={styles.wrap}>
      <LearningTopicTabs items={categories} value={value} onChange={onChangeCategory} />

      <View style={styles.caseSurface}>
        {loading && !items.length ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={palette.accentStrong} />
            <Text style={styles.loadingText}>案例加载中</Text>
          </View>
        ) : items.length ? (
          items.map((item, index) => {
            const tags = buildCaseTags(item);
            const coverUrl = resolveApiFileUrl(item.cover_url);
            return (
              <Pressable
                key={item.id}
                style={({ pressed }) => [
                  styles.caseRow,
                  index < items.length - 1 && styles.caseRowDivider,
                  pressed && styles.pressed,
                ]}
                onPress={() => onOpenCase(item)}
              >
                <View style={styles.caseCopy}>
                  <View style={styles.caseTagRow}>
                    {tags.map((tag) => (
                      <View key={`${item.id}-${tag}`} style={styles.caseTag}>
                        <Text style={styles.caseTagText}>{tag}</Text>
                      </View>
                    ))}
                  </View>

                  <Text style={styles.caseTitle} numberOfLines={2}>
                    {item.title}
                  </Text>

                  {item.summary ? (
                    <Text style={styles.caseSummary} numberOfLines={2}>
                      {item.summary}
                    </Text>
                  ) : null}

                  <View style={styles.caseMetaRow}>
                    <Text style={styles.caseMetaSource} numberOfLines={1}>
                      {item.source_name}
                    </Text>
                    <Text style={styles.caseMetaDate}>
                      {formatCaseDate(item.source_published_at ?? item.published_at)}
                    </Text>
                  </View>
                </View>

                {coverUrl ? (
                  <Image
                    source={{ uri: coverUrl }}
                    style={styles.caseImage}
                    contentFit="cover"
                    transition={120}
                  />
                ) : (
                  <View style={styles.caseImagePlaceholder}>
                    <MaterialCommunityIcons
                      name="newspaper-variant-outline"
                      size={26}
                      color={palette.accentStrong}
                    />
                  </View>
                )}
              </Pressable>
            );
          })
        ) : (
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyTitle}>暂无案例</Text>
            <Text style={styles.emptyMeta}>换个分类看看</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 14,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 24,
  },
  caseSurface: {
    borderRadius: radius.xl,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    overflow: "hidden",
    ...panelShadow,
  },
  loadingWrap: {
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 28,
  },
  loadingText: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fontFamily.body,
  },
  caseRow: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  caseRowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: palette.line,
  },
  caseCopy: {
    flex: 1,
    gap: 8,
  },
  caseTagRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  caseTag: {
    borderRadius: radius.pill,
    backgroundColor: palette.accentSoft,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  caseTagText: {
    color: palette.accentStrong,
    fontSize: 10,
    lineHeight: 12,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  caseTitle: {
    color: palette.ink,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  caseSummary: {
    color: palette.inkSoft,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  caseMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  caseMetaSource: {
    flex: 1,
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fontFamily.body,
  },
  caseMetaDate: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fontFamily.body,
  },
  caseImage: {
    width: 104,
    height: 78,
    borderRadius: radius.md,
    backgroundColor: palette.backgroundDeep,
  },
  caseImagePlaceholder: {
    width: 104,
    height: 78,
    borderRadius: radius.md,
    backgroundColor: palette.surfaceSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyWrap: {
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 30,
  },
  emptyTitle: {
    color: palette.ink,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  emptyMeta: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fontFamily.body,
  },
  pressed: {
    opacity: 0.92,
  },
});
