import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { useAuth } from "@/features/auth";
import { ApiError } from "@/shared/api";
import { fontFamily, palette, radius } from "@/shared/theme";
import { TaskPrimaryButton, TaskScreen } from "@/shared/ui/TaskScreen";

import { detectionsApi } from "../api";
import type {
  WebPhishingPredictResponse,
  WebPhishingRiskLevel,
} from "../types";

function riskMeta(level: WebPhishingRiskLevel, isPhishing: boolean) {
  switch (level) {
    case "high":
      return { label: "高风险", tint: "#D96A4A", soft: "#FFF0EA" };
    case "medium":
    case "suspicious":
      return { label: "可疑", tint: "#C48A29", soft: "#FFF7E8" };
    default:
      return isPhishing
        ? { label: "可疑", tint: "#C48A29", soft: "#FFF7E8" }
        : { label: "安全", tint: "#2F70E6", soft: "#EAF2FF" };
  }
}

function formatPercent(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "--";
  }
  return `${(value * 100).toFixed(1)}%`;
}

export function WebPhishingScreen() {
  const router = useRouter();
  const { token } = useAuth();
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<WebPhishingPredictResponse | null>(null);

  const meta = useMemo(
    () => riskMeta(result?.risk_level ?? "safe", Boolean(result?.is_phishing)),
    [result],
  );

  const handleSubmit = useCallback(async () => {
    if (!token) {
      Alert.alert("未登录", "请先登录");
      return;
    }
    if (!url.trim()) {
      Alert.alert("请输入网址", "先补充网址");
      return;
    }

    setSubmitting(true);
    try {
      const next = await detectionsApi.predictWebPhishing(token, {
        url: url.trim(),
        return_features: false,
      });
      if (next.submission_id) {
        router.replace({
          pathname: "/records/[id]",
          params: { id: next.submission_id },
        });
        return;
      }
      setResult(next);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "检测失败";
      Alert.alert("检测失败", message);
    } finally {
      setSubmitting(false);
    }
  }, [router, token, url]);

  return (
    <TaskScreen
      title="网址钓鱼检测"
      footer={
        <TaskPrimaryButton
          label="开始检测"
          onPress={() => void handleSubmit()}
          disabled={!url.trim()}
          loading={submitting}
        />
      }
    >
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.headRow}>
          <View style={[styles.iconWrap, { backgroundColor: "#FFF7E8" }]}>
            <MaterialCommunityIcons
              name="web-check"
              size={22}
              color="#D68910"
            />
          </View>
          <View style={styles.headCopy}>
            <Text style={styles.headTitle}>网址钓鱼检测</Text>
            <Text style={styles.headMeta}>单条网址</Text>
          </View>
        </View>

        <View style={styles.inputWrap}>
          <TextInput
            style={styles.input}
            value={url}
            onChangeText={setUrl}
            placeholder="https://example.com"
            placeholderTextColor={palette.inkSoft}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
        </View>

        <View style={styles.resultCard}>
          <View style={[styles.resultBadge, { backgroundColor: meta.soft }]}>
            <Text style={[styles.resultBadgeText, { color: meta.tint }]}>
              {result ? meta.label : "未检测"}
            </Text>
          </View>

          <View style={styles.metricRow}>
            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>钓鱼概率</Text>
              <Text style={styles.metricValue}>
                {formatPercent(result?.phish_prob)}
              </Text>
            </View>
            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>可信度</Text>
              <Text style={styles.metricValue}>
                {formatPercent(result?.confidence)}
              </Text>
            </View>
          </View>

          <Text style={styles.resultUrl}>
            {result?.url || "检测后显示网址"}
          </Text>
        </View>
      </ScrollView>
    </TaskScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 16,
    paddingBottom: 6,
  },
  headRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  headCopy: {
    flex: 1,
    gap: 4,
  },
  headTitle: {
    color: palette.ink,
    fontSize: 19,
    lineHeight: 24,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  headMeta: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 17,
    fontFamily: fontFamily.body,
  },
  inputWrap: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.surfaceSoft,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  input: {
    color: palette.ink,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: fontFamily.body,
  },
  resultCard: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.surfaceSoft,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 14,
  },
  resultBadge: {
    alignSelf: "flex-start",
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  resultBadgeText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  metricRow: {
    flexDirection: "row",
    gap: 10,
  },
  metricCard: {
    flex: 1,
    borderRadius: radius.md,
    backgroundColor: palette.surface,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 4,
  },
  metricLabel: {
    color: palette.inkSoft,
    fontSize: 11,
    lineHeight: 15,
    fontFamily: fontFamily.body,
  },
  metricValue: {
    color: palette.ink,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  resultUrl: {
    color: palette.ink,
    fontSize: 13,
    lineHeight: 19,
    fontFamily: fontFamily.body,
  },
});
