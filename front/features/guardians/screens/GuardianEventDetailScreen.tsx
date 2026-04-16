import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
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

import { guardiansApi } from "../api";
import { guardianRelationMeta, type GuardianActionType, type GuardianEvent } from "../types";

function formatDateTime(value?: string | null) {
  if (!value) {
    return "--";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function toStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => String(item)).filter(Boolean);
}

function toRuleItems(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((item) => ({
      name: String(item.name ?? ""),
      explanation: String(item.explanation ?? ""),
    }))
    .filter((item) => item.name || item.explanation);
}

function getContactName(event: GuardianEvent) {
  if (event.ownership === "guardian") {
    return event.ward_display_name ?? event.ward_phone ?? "被监护人";
  }
  return event.guardian_name ?? "监护人";
}

function getContactPhone(event: GuardianEvent) {
  return event.ownership === "guardian" ? event.ward_phone : event.guardian_phone;
}

function getContactRoleLabel(event: GuardianEvent) {
  return event.ownership === "guardian" ? "被监护人" : "监护人";
}

export default function GuardianEventDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { token } = useAuth();
  const [event, setEvent] = useState<GuardianEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDetail = useCallback(async () => {
    if (!token || !id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await guardiansApi.getEvent(id, token);
      setEvent(response);
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

  const evidence = event?.evidence_json ?? {};
  const adviceList = useMemo(() => toStringArray(evidence.advice), [evidence.advice]);
  const hitRules = useMemo(() => toStringArray(evidence.hit_rules), [evidence.hit_rules]);
  const ruleItems = useMemo(() => toRuleItems(evidence.rule_hits), [evidence.rule_hits]);
  const contactName = event ? getContactName(event) : "";
  const contactPhone = event ? getContactPhone(event) : null;
  const contactRoleLabel = event ? getContactRoleLabel(event) : "联系人";

  const handleAction = useCallback(
    async (actionType: GuardianActionType, options?: { openUrl?: string; note?: string }) => {
      if (!token || !event || acting) {
        return;
      }
      setActing(true);
      try {
        const response = await guardiansApi.createIntervention(
          event.id,
          {
            action_type: actionType,
            note: options?.note ?? null,
          },
          token
        );
        setEvent(response);
        if (options?.openUrl) {
          await Linking.openURL(options.openUrl);
        }
      } catch (err) {
        Alert.alert("操作失败", err instanceof ApiError ? err.message : "请稍后重试");
      } finally {
        setActing(false);
      }
    },
    [acting, event, token]
  );

  const handleContactAction = useCallback(
    (actionType: "call" | "message") => {
      if (!event) {
        return;
      }
      if (!contactPhone) {
        Alert.alert("缺少手机号", `当前${contactRoleLabel}未留手机号`);
        return;
      }
      const openUrl = actionType === "call" ? `tel:${contactPhone}` : `sms:${contactPhone}`;
      const note = actionType === "call" ? `已电话联系${contactName}` : `已短信联系${contactName}`;
      void handleAction(actionType, { openUrl, note });
    },
    [contactName, contactPhone, contactRoleLabel, event, handleAction]
  );

  return (
    <View style={styles.root}>
      <AuthBackdrop />
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <View style={styles.header}>
          <Pressable style={({ pressed }) => [styles.backButton, pressed && styles.buttonPressed]} onPress={() => router.back()}>
            <MaterialCommunityIcons name="chevron-left" size={22} color={palette.ink} />
          </Pressable>
          <Text style={styles.headerTitle}>联动详情</Text>
          <View style={styles.backButton} />
        </View>

        {loading ? (
          <View style={styles.centerWrap}>
            <ActivityIndicator size="small" color={palette.accentStrong} />
          </View>
        ) : error || !event ? (
          <View style={styles.centerWrap}>
            <Text style={styles.errorText}>{error ?? "记录不存在"}</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <View style={styles.heroCard}>
              <Text style={styles.heroRisk}>{event.risk_level.toUpperCase()}</Text>
              <Text style={styles.heroTitle}>{event.summary}</Text>
              <Text style={styles.heroMeta}>
                {contactRoleLabel} · {contactName}
              </Text>
              <Text style={styles.heroMeta}>
                {guardianRelationMeta[event.guardian_relation].label} · {contactPhone ?? "未留手机号"}
              </Text>
              <Text style={styles.heroSubline}>
                {event.notify_status === "read" ? "已查看" : "已通知"} · {formatDateTime(event.created_at)}
              </Text>
            </View>

            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>干预</Text>
              <View style={styles.actionGrid}>
                <Pressable
                  onPress={() => handleContactAction("call")}
                  disabled={!contactPhone || acting}
                  style={({ pressed }) => [
                    styles.actionButton,
                    pressed && styles.buttonPressed,
                    (!contactPhone || acting) && styles.actionButtonDisabled,
                  ]}
                >
                  <MaterialCommunityIcons name="phone-outline" size={18} color={palette.accentStrong} />
                  <Text style={styles.actionText}>打电话</Text>
                </Pressable>
                <Pressable
                  onPress={() => handleContactAction("message")}
                  disabled={!contactPhone || acting}
                  style={({ pressed }) => [
                    styles.actionButton,
                    pressed && styles.buttonPressed,
                    (!contactPhone || acting) && styles.actionButtonDisabled,
                  ]}
                >
                  <MaterialCommunityIcons name="message-outline" size={18} color={palette.accentStrong} />
                  <Text style={styles.actionText}>发短信</Text>
                </Pressable>
                <Pressable
                  onPress={() => void handleAction("suggest_alarm", { note: "建议报警" })}
                  style={({ pressed }) => [styles.actionButton, pressed && styles.buttonPressed]}
                >
                  <MaterialCommunityIcons name="shield-alert-outline" size={18} color={palette.accentStrong} />
                  <Text style={styles.actionText}>建议报警</Text>
                </Pressable>
                <Pressable
                  onPress={() => void handleAction("remote_assist", { note: "建议改用语音或屏幕共享协助" })}
                  style={({ pressed }) => [styles.actionButton, pressed && styles.buttonPressed]}
                >
                  <MaterialCommunityIcons name="laptop" size={18} color={palette.accentStrong} />
                  <Text style={styles.actionText}>远程协助</Text>
                </Pressable>
              </View>
            </View>

            {adviceList.length ? (
              <View style={styles.sectionCard}>
                <Text style={styles.sectionTitle}>建议</Text>
                <View style={styles.listGap}>
                  {adviceList.map((item) => (
                    <Text key={item} style={styles.sectionText}>
                      • {item}
                    </Text>
                  ))}
                </View>
              </View>
            ) : null}

            {hitRules.length || ruleItems.length ? (
              <View style={styles.sectionCard}>
                <Text style={styles.sectionTitle}>线索</Text>
                <View style={styles.listGap}>
                  {hitRules.map((item) => (
                    <Text key={item} style={styles.sectionText}>
                      • {item}
                    </Text>
                  ))}
                  {ruleItems.map((item) => (
                    <View key={`${item.name}-${item.explanation}`} style={styles.ruleRow}>
                      <Text style={styles.ruleName}>{item.name}</Text>
                      {item.explanation ? <Text style={styles.ruleDesc}>{item.explanation}</Text> : null}
                    </View>
                  ))}
                </View>
              </View>
            ) : null}

            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>动作记录</Text>
              {event.interventions.length ? (
                <View style={styles.listGap}>
                  {event.interventions.map((item) => (
                    <View key={item.id} style={styles.logRow}>
                      <Text style={styles.logTitle}>
                        {item.actor_display_name ?? "用户"} · {item.action_type}
                      </Text>
                      <Text style={styles.logTime}>{formatDateTime(item.created_at)}</Text>
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={styles.sectionText}>暂无动作</Text>
              )}
            </View>
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
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
  },
  headerTitle: {
    color: palette.ink,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  centerWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 24,
    gap: 16,
  },
  heroCard: {
    borderRadius: radius.xl,
    padding: 18,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    gap: 6,
    ...panelShadow,
  },
  heroRisk: {
    color: palette.accentStrong,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  heroTitle: {
    color: palette.ink,
    fontSize: 20,
    lineHeight: 27,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  heroMeta: {
    color: palette.inkSoft,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  heroSubline: {
    color: palette.lineStrong,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fontFamily.body,
  },
  sectionCard: {
    borderRadius: radius.xl,
    padding: 16,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    gap: 12,
    ...panelShadow,
  },
  sectionTitle: {
    color: palette.ink,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  actionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  actionButton: {
    minWidth: "47%",
    flexGrow: 1,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.surfaceSoft,
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  actionButtonDisabled: {
    opacity: 0.48,
  },
  actionText: {
    color: palette.ink,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  listGap: {
    gap: 8,
  },
  sectionText: {
    color: palette.inkSoft,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  ruleRow: {
    borderRadius: radius.md,
    backgroundColor: palette.surfaceSoft,
    padding: 10,
    gap: 4,
  },
  ruleName: {
    color: palette.ink,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  ruleDesc: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fontFamily.body,
  },
  logRow: {
    borderRadius: radius.md,
    backgroundColor: palette.surfaceSoft,
    padding: 10,
    gap: 4,
  },
  logTitle: {
    color: palette.ink,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  logTime: {
    color: palette.lineStrong,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fontFamily.body,
  },
  errorText: {
    color: palette.danger,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: fontFamily.body,
  },
  buttonPressed: {
    opacity: 0.92,
  },
});
