import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AuthBackdrop, useAuth } from "@/features/auth";
import { ApiError } from "@/shared/api";
import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";

import { guardianReportsApi } from "../api";
import type { GuardianReportRiskLevel, GuardianReportType, GuardianSafetyReport } from "../types";

const REPORT_TYPE_OPTIONS: Array<{ key: GuardianReportType; label: string }> = [
  { key: "day", label: "日报" },
  { key: "month", label: "月报" },
  { key: "year", label: "年报" },
];

function riskColor(level: GuardianReportRiskLevel | string) {
  if (level === "high") {
    return "#E45757";
  }
  if (level === "medium") {
    return "#F0A43A";
  }
  return "#4D8BFF";
}

function riskLabel(level: GuardianReportRiskLevel | string) {
  if (level === "high") {
    return "高风险";
  }
  if (level === "medium") {
    return "中风险";
  }
  return "低风险";
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export default function GuardianReportCenterScreen() {
  const router = useRouter();
  const { token } = useAuth();
  const [reportType, setReportType] = useState<GuardianReportType>("day");
  const [reports, setReports] = useState<GuardianSafetyReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadReports = useCallback(async () => {
    if (!token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const rows = await guardianReportsApi.list(token, {
        report_type: reportType,
        limit: 20,
        offset: 0,
      });
      setReports(rows);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [reportType, token]);

  useFocusEffect(
    useCallback(() => {
      void loadReports();
    }, [loadReports])
  );

  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        router.replace("/guardians");
        return true;
      });
      return () => sub.remove();
    }, [router])
  );

  const canGenerate = useMemo(() => Boolean(token) && !generating, [generating, token]);

  const handleGenerate = useCallback(async () => {
    if (!token || !canGenerate) {
      return;
    }
    setGenerating(true);
    try {
      const report = await guardianReportsApi.generate(
        {
          report_type: reportType,
          force_regenerate: true,
        },
        token
      );
      await loadReports();
      router.push({
        pathname: "/guardians/reports/[id]" as never,
        params: { id: report.id } as never,
      });
    } catch (err) {
      Alert.alert("生成失败", err instanceof ApiError ? err.message : "请稍后重试");
    } finally {
      setGenerating(false);
    }
  }, [canGenerate, loadReports, reportType, router, token]);

  return (
    <View style={styles.root}>
      <AuthBackdrop />
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <View style={styles.header}>
          <Pressable
            style={({ pressed }) => [styles.iconButton, pressed && styles.buttonPressed]}
            onPress={() => router.replace("/guardians")}
          >
            <MaterialCommunityIcons name="chevron-left" size={20} color={palette.accentStrong} />
          </Pressable>
          <View style={styles.headerCopy}>
            <Text style={styles.pageTitle}>安全监测报告</Text>
            <Text style={styles.pageSubtitle}>监护人日报 / 月报 / 年报</Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.filterCard}>
            <View style={styles.typeRow}>
              {REPORT_TYPE_OPTIONS.map((item) => {
                const active = reportType === item.key;
                return (
                  <Pressable
                    key={item.key}
                    onPress={() => setReportType(item.key)}
                    style={({ pressed }) => [
                      styles.typeChip,
                      active && styles.typeChipActive,
                      pressed && styles.buttonPressed,
                    ]}
                  >
                    <Text style={[styles.typeChipText, active && styles.typeChipTextActive]}>{item.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Pressable
              onPress={() => void handleGenerate()}
              disabled={!canGenerate}
              style={({ pressed }) => [
                styles.generateButton,
                pressed && styles.buttonPressed,
                !canGenerate && styles.buttonDisabled,
              ]}
            >
              {generating ? <ActivityIndicator size="small" color={palette.inkInverse} /> : null}
              <Text style={styles.generateButtonText}>{generating ? "生成中" : "重新生成"}</Text>
            </Pressable>
          </View>

          {loading ? (
            <View style={styles.stateCard}>
              <ActivityIndicator size="small" color={palette.accentStrong} />
              <Text style={styles.stateText}>加载中</Text>
            </View>
          ) : reports.length ? (
            <View style={styles.reportColumn}>
              {reports.map((item) => (
                <Pressable
                  key={item.id}
                  onPress={() =>
                    router.push({
                      pathname: "/guardians/reports/[id]" as never,
                      params: { id: item.id } as never,
                    })
                  }
                  style={({ pressed }) => [styles.reportCard, pressed && styles.buttonPressed]}
                >
                  <View style={styles.cardTop}>
                    <Text style={styles.reportLabel}>{item.period_label}</Text>
                    <View style={styles.rightRow}>
                      {!item.is_read ? <View style={styles.unreadDot} /> : null}
                      <View style={[styles.riskPill, { backgroundColor: `${riskColor(item.overall_risk_level)}20` }]}>
                        <Text style={[styles.riskPillText, { color: riskColor(item.overall_risk_level) }]}>
                          {riskLabel(item.overall_risk_level)}
                        </Text>
                      </View>
                    </View>
                  </View>
                  <View style={styles.metricRow}>
                    <Text style={styles.metricText}>高 {item.high_count}</Text>
                    <Text style={styles.metricText}>中 {item.medium_count}</Text>
                    <Text style={styles.metricText}>低 {item.low_count}</Text>
                    <Text style={styles.metricText}>分 {item.overall_risk_score}</Text>
                  </View>
                  <Text style={styles.summaryText} numberOfLines={2}>
                    {item.llm_summary || item.llm_title || "已生成报告"}
                  </Text>
                  <Text style={styles.timeText}>{formatTime(item.updated_at)}</Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <View style={styles.stateCard}>
              <Text style={styles.stateText}>暂无报告</Text>
            </View>
          )}

          {error ? <Text style={styles.errorText}>{error}</Text> : null}
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
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 12,
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  headerCopy: {
    flex: 1,
    gap: 2,
  },
  pageTitle: {
    color: palette.ink,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  pageSubtitle: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fontFamily.body,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 24,
    gap: 14,
  },
  filterCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.surface,
    padding: 14,
    gap: 12,
    ...panelShadow,
  },
  typeRow: {
    flexDirection: "row",
    gap: 8,
  },
  typeChip: {
    flex: 1,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.surfaceSoft,
    paddingVertical: 8,
    alignItems: "center",
  },
  typeChipActive: {
    borderColor: palette.accentStrong,
    backgroundColor: palette.accentSoft,
  },
  typeChipText: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  typeChipTextActive: {
    color: palette.accentStrong,
  },
  generateButton: {
    borderRadius: radius.pill,
    backgroundColor: palette.accentStrong,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    paddingVertical: 11,
  },
  generateButtonText: {
    color: palette.inkInverse,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  reportColumn: {
    gap: 10,
  },
  reportCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.surface,
    padding: 14,
    gap: 8,
    ...panelShadow,
  },
  cardTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  reportLabel: {
    flex: 1,
    color: palette.ink,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  rightRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  unreadDot: {
    width: 6,
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: palette.accentStrong,
  },
  riskPill: {
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  riskPillText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  metricRow: {
    flexDirection: "row",
    gap: 8,
  },
  metricText: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fontFamily.body,
  },
  summaryText: {
    color: palette.ink,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  timeText: {
    color: palette.lineStrong,
    fontSize: 11,
    lineHeight: 15,
    fontFamily: fontFamily.body,
  },
  stateCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.surface,
    minHeight: 120,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    ...panelShadow,
  },
  stateText: {
    color: palette.inkSoft,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  errorText: {
    color: palette.danger,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fontFamily.body,
  },
  buttonPressed: {
    opacity: 0.9,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});
