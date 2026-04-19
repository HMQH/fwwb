import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
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
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AuthBackdrop, useAuth } from "@/features/auth";
import { TrendLineChart } from "@/features/records/components/TrendLineChart";
import { ApiError } from "@/shared/api";
import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";

import { guardianReportsApi } from "../api";
import { FraudBarChart } from "../components/FraudBarChart";
import { PieRiskChart } from "../components/PieRiskChart";
import type {
  GuardianReportAction,
  GuardianReportPayload,
  GuardianSafetyReport,
} from "../types";

function riskColor(level?: string | null) {
  if (level === "high") {
    return "#E45757";
  }
  if (level === "medium") {
    return "#F0A43A";
  }
  return "#4D8BFF";
}

function toPayload(value: unknown): GuardianReportPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as GuardianReportPayload;
}

function formatTime(value?: string | null) {
  if (!value) {
    return "--";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export default function GuardianReportDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { token } = useAuth();
  const { width } = useWindowDimensions();

  const [report, setReport] = useState<GuardianSafetyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [actingActionId, setActingActionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadDetail = useCallback(async () => {
    if (!token || !id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const detail = await guardianReportsApi.get(id, token);
      setReport(detail);
      if (!detail.is_read) {
        const readDetail = await guardianReportsApi.markRead(id, token);
        setReport(readDetail);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [id, token]);

  useFocusEffect(
    useCallback(() => {
      void loadDetail();
    }, [loadDetail])
  );

  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        router.replace("/guardians/reports");
        return true;
      });
      return () => sub.remove();
    }, [router])
  );

  const payload = useMemo(() => toPayload(report?.payload), [report?.payload]);
  const metrics = payload.metrics;
  const llmReport = payload.llm_report;
  const pie = payload.charts?.pie ?? [];
  const linePoints = payload.charts?.line?.points ?? [];
  const barItems = payload.charts?.bar?.items ?? [];
  const topEvidence = payload.top_evidence ?? [];
  const stageTrajectory = payload.stage_trajectory ?? [];
  const keyMoments = payload.key_moments ?? [];
  const highRiskCases = payload.high_risk_cases ?? [];

  const updateActionStatus = useCallback(
    async (action: GuardianReportAction, status: "in_progress" | "completed") => {
      if (!token || !report || actingActionId) {
        return;
      }
      setActingActionId(action.id);
      try {
        const detail = await guardianReportsApi.updateActionStatus(
          report.id,
          action.id,
          status,
          token
        );
        setReport(detail);
      } catch (err) {
        Alert.alert("更新失败", err instanceof ApiError ? err.message : "请稍后重试");
      } finally {
        setActingActionId(null);
      }
    },
    [actingActionId, report, token]
  );

  return (
    <View style={styles.root}>
      <AuthBackdrop />
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <View style={styles.header}>
          <Pressable
            style={({ pressed }) => [styles.iconButton, pressed && styles.buttonPressed]}
            onPress={() => router.replace("/guardians/reports")}
          >
            <MaterialCommunityIcons name="chevron-left" size={20} color={palette.accentStrong} />
          </Pressable>
          <Text style={styles.pageTitle}>报告详情</Text>
          <View style={styles.iconButton} />
        </View>

        {loading ? (
          <View style={styles.centerWrap}>
            <ActivityIndicator size="small" color={palette.accentStrong} />
          </View>
        ) : error || !report ? (
          <View style={styles.centerWrap}>
            <Text style={styles.errorText}>{error ?? "报告不存在"}</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <View style={styles.heroCard}>
              <View style={styles.heroTop}>
                <Text style={styles.heroTitle}>{llmReport?.title || report.period_label}</Text>
                <View style={[styles.riskPill, { backgroundColor: `${riskColor(report.overall_risk_level)}20` }]}>
                  <Text style={[styles.riskPillText, { color: riskColor(report.overall_risk_level) }]}>
                    {report.overall_risk_level.toUpperCase()} / {report.overall_risk_score}
                  </Text>
                </View>
              </View>
              <Text style={styles.heroSummary}>{llmReport?.summary || "已生成监测报告"}</Text>
              <Text style={styles.heroMeta}>
                {report.period_label} · {formatTime(report.updated_at)}
              </Text>
              {llmReport?.risk_overview ? <Text style={styles.heroMeta}>{llmReport.risk_overview}</Text> : null}
            </View>

            <View style={styles.metricCard}>
              <View style={styles.metricRow}>
                <View style={styles.metricItem}>
                  <Text style={styles.metricLabel}>提交</Text>
                  <Text style={styles.metricValue}>{report.total_submissions}</Text>
                </View>
                <View style={styles.metricItem}>
                  <Text style={styles.metricLabel}>结果</Text>
                  <Text style={styles.metricValue}>{report.total_results}</Text>
                </View>
                <View style={styles.metricItem}>
                  <Text style={styles.metricLabel}>高</Text>
                  <Text style={[styles.metricValue, { color: "#E45757" }]}>{report.high_count}</Text>
                </View>
                <View style={styles.metricItem}>
                  <Text style={styles.metricLabel}>中</Text>
                  <Text style={[styles.metricValue, { color: "#F0A43A" }]}>{report.medium_count}</Text>
                </View>
                <View style={styles.metricItem}>
                  <Text style={styles.metricLabel}>低</Text>
                  <Text style={[styles.metricValue, { color: "#4D8BFF" }]}>{report.low_count}</Text>
                </View>
              </View>
              {metrics ? (
                <View style={styles.metricSubRow}>
                  <Text style={styles.metricSubText}>覆盖率 {Math.round((metrics.completion_rate || 0) * 100)}%</Text>
                  <Text style={styles.metricSubText}>平均置信 {metrics.avg_confidence ?? 0}</Text>
                </View>
              ) : null}
            </View>

            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>风险分布</Text>
              <PieRiskChart segments={pie} />
            </View>

            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>风险趋势</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <TrendLineChart points={linePoints} width={Math.max(width - 64, linePoints.length * 46)} />
              </ScrollView>
            </View>

            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>欺诈类型</Text>
              <FraudBarChart items={barItems} />
            </View>

            {llmReport?.key_findings?.length ? (
              <View style={styles.sectionCard}>
                <Text style={styles.sectionTitle}>关键结论</Text>
                <View style={styles.listGap}>
                  {llmReport.key_findings.map((item) => (
                    <Text key={item} style={styles.sectionText}>
                      • {item}
                    </Text>
                  ))}
                </View>
              </View>
            ) : null}

            {llmReport?.anomaly_notes?.length ? (
              <View style={styles.sectionCard}>
                <Text style={styles.sectionTitle}>异常提示</Text>
                <View style={styles.listGap}>
                  {llmReport.anomaly_notes.map((item) => (
                    <Text key={item} style={styles.sectionText}>
                      • {item}
                    </Text>
                  ))}
                </View>
              </View>
            ) : null}

            {report.actions.length ? (
              <View style={styles.sectionCard}>
                <Text style={styles.sectionTitle}>执行动作</Text>
                <View style={styles.listGap}>
                  {report.actions.map((item) => (
                    <View key={item.id} style={styles.actionRow}>
                      <View style={styles.actionCopy}>
                        <Text style={styles.actionTitle}>{item.action_label}</Text>
                        {item.action_detail ? <Text style={styles.actionDetail}>{item.action_detail}</Text> : null}
                        <Text style={styles.actionMeta}>
                          {item.priority.toUpperCase()} · {item.action_type} · {item.status}
                        </Text>
                      </View>
                      {item.status !== "completed" ? (
                        <View style={styles.actionButtons}>
                          <Pressable
                            onPress={() => void updateActionStatus(item, "in_progress")}
                            style={({ pressed }) => [styles.inlineButton, pressed && styles.buttonPressed]}
                            disabled={actingActionId === item.id}
                          >
                            <Text style={styles.inlineButtonText}>跟进</Text>
                          </Pressable>
                          <Pressable
                            onPress={() => void updateActionStatus(item, "completed")}
                            style={({ pressed }) => [styles.inlineButtonPrimary, pressed && styles.buttonPressed]}
                            disabled={actingActionId === item.id}
                          >
                            <Text style={styles.inlineButtonPrimaryText}>完成</Text>
                          </Pressable>
                        </View>
                      ) : (
                        <Text style={styles.actionDone}>已完成</Text>
                      )}
                    </View>
                  ))}
                </View>
              </View>
            ) : null}

            {topEvidence.length ? (
              <View style={styles.sectionCard}>
                <Text style={styles.sectionTitle}>关键证据</Text>
                <View style={styles.listGap}>
                  {topEvidence.map((item, index) => (
                    <View key={`${item.title}-${index}`} style={styles.evidenceItem}>
                      <View style={styles.evidenceTop}>
                        <Text style={styles.evidenceTitle}>{item.title}</Text>
                        <Text style={styles.evidenceCount}>×{item.count}</Text>
                      </View>
                      {item.detail ? <Text style={styles.sectionText}>{item.detail}</Text> : null}
                    </View>
                  ))}
                </View>
              </View>
            ) : null}

            {stageTrajectory.length ? (
              <View style={styles.sectionCard}>
                <Text style={styles.sectionTitle}>阶段轨迹</Text>
                <View style={styles.listGap}>
                  {stageTrajectory.map((item) => (
                    <View key={item.stage} style={styles.stageRow}>
                      <Text style={styles.stageLabel}>{item.stage}</Text>
                      <View style={styles.stageTrack}>
                        <View style={[styles.stageFill, { width: `${Math.max(6, Math.round((item.ratio || 0) * 100))}%` }]} />
                      </View>
                      <Text style={styles.stageCount}>{item.count}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}

            {keyMoments.length ? (
              <View style={styles.sectionCard}>
                <Text style={styles.sectionTitle}>关键时刻</Text>
                <View style={styles.listGap}>
                  {keyMoments.map((item) => (
                    <View key={item.id} style={styles.momentRow}>
                      <Text style={styles.momentTitle}>
                        {item.label} · {item.time_sec}s
                      </Text>
                      <Text style={styles.sectionText}>{item.description}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}

            {highRiskCases.length ? (
              <View style={styles.sectionCard}>
                <Text style={styles.sectionTitle}>重点风险记录</Text>
                <View style={styles.listGap}>
                  {highRiskCases.map((item) => (
                    <View key={item.result_id} style={styles.caseRow}>
                      <Text style={styles.caseTitle}>
                        {item.risk_level.toUpperCase()} · {item.fraud_type || "未分类"}
                      </Text>
                      <Text style={styles.sectionText} numberOfLines={2}>
                        {item.summary}
                      </Text>
                      <Text style={styles.caseMeta}>{formatTime(item.created_at)}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}
          </ScrollView>
        )}
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
    justifyContent: "space-between",
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
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
  pageTitle: {
    flex: 1,
    textAlign: "center",
    color: palette.ink,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 24,
    gap: 14,
  },
  heroCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.surface,
    padding: 16,
    gap: 8,
    ...panelShadow,
  },
  heroTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
  },
  heroTitle: {
    flex: 1,
    color: palette.ink,
    fontSize: 17,
    lineHeight: 23,
    fontWeight: "900",
    fontFamily: fontFamily.display,
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
  heroSummary: {
    color: palette.ink,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  heroMeta: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fontFamily.body,
  },
  metricCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.surface,
    padding: 14,
    gap: 8,
    ...panelShadow,
  },
  metricRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  metricItem: {
    minWidth: "18%",
    flex: 1,
    borderRadius: radius.md,
    backgroundColor: palette.surfaceSoft,
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 6,
    gap: 2,
  },
  metricLabel: {
    color: palette.inkSoft,
    fontSize: 11,
    lineHeight: 14,
    fontFamily: fontFamily.body,
  },
  metricValue: {
    color: palette.ink,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  metricSubRow: {
    flexDirection: "row",
    gap: 12,
  },
  metricSubText: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fontFamily.body,
  },
  sectionCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.surface,
    padding: 14,
    gap: 10,
    ...panelShadow,
  },
  sectionTitle: {
    color: palette.ink,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  listGap: {
    gap: 8,
  },
  sectionText: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 17,
    fontFamily: fontFamily.body,
  },
  actionRow: {
    borderRadius: radius.md,
    backgroundColor: palette.surfaceSoft,
    padding: 10,
    gap: 8,
  },
  actionCopy: {
    gap: 4,
  },
  actionTitle: {
    color: palette.ink,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  actionDetail: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fontFamily.body,
  },
  actionMeta: {
    color: palette.lineStrong,
    fontSize: 11,
    lineHeight: 14,
    fontFamily: fontFamily.body,
  },
  actionButtons: {
    flexDirection: "row",
    gap: 8,
  },
  inlineButton: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.surface,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  inlineButtonText: {
    color: palette.inkSoft,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  inlineButtonPrimary: {
    borderRadius: radius.pill,
    backgroundColor: palette.accentStrong,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  inlineButtonPrimaryText: {
    color: palette.inkInverse,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  actionDone: {
    color: palette.accentStrong,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  evidenceItem: {
    borderRadius: radius.md,
    backgroundColor: palette.surfaceSoft,
    padding: 10,
    gap: 4,
  },
  evidenceTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  evidenceTitle: {
    flex: 1,
    color: palette.ink,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  evidenceCount: {
    color: palette.accentStrong,
    fontSize: 11,
    lineHeight: 14,
    fontFamily: fontFamily.body,
  },
  stageRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  stageLabel: {
    width: 78,
    color: palette.ink,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fontFamily.body,
  },
  stageTrack: {
    flex: 1,
    height: 8,
    borderRadius: radius.pill,
    overflow: "hidden",
    backgroundColor: palette.surfaceSoft,
  },
  stageFill: {
    height: "100%",
    borderRadius: radius.pill,
    backgroundColor: palette.accentStrong,
  },
  stageCount: {
    width: 26,
    textAlign: "right",
    color: palette.inkSoft,
    fontSize: 11,
    lineHeight: 14,
    fontFamily: fontFamily.body,
  },
  momentRow: {
    borderRadius: radius.md,
    backgroundColor: palette.surfaceSoft,
    padding: 10,
    gap: 4,
  },
  momentTitle: {
    color: palette.ink,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  caseRow: {
    borderRadius: radius.md,
    backgroundColor: palette.surfaceSoft,
    padding: 10,
    gap: 4,
  },
  caseTitle: {
    color: palette.ink,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  caseMeta: {
    color: palette.lineStrong,
    fontSize: 11,
    lineHeight: 14,
    fontFamily: fontFamily.body,
  },
  centerWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  errorText: {
    color: palette.danger,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  buttonPressed: {
    opacity: 0.9,
  },
});
