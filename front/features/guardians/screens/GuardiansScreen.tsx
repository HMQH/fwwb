import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AuthBackdrop, useAuth } from "@/features/auth";
import { ApiError } from "@/shared/api";
import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";

import { guardiansApi } from "../api";
import { guardianRelationMeta, type GuardianBinding, type GuardianBindingRelation, type GuardianEvent } from "../types";

const relationOptions: GuardianBindingRelation[] = ["parent", "spouse", "child", "relative"];

function formatDateTime(value?: string | null) {
  if (!value) {
    return "--";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function getStatusLabel(status: GuardianBinding["status"]) {
  if (status === "active") {
    return "已生效";
  }
  if (status === "pending") {
    return "待确认";
  }
  if (status === "rejected") {
    return "已拒绝";
  }
  return "已解除";
}

function getEventStatusLabel(status: GuardianEvent["notify_status"]) {
  if (status === "sent") {
    return "已通知";
  }
  if (status === "read") {
    return "已查看";
  }
  if (status === "failed") {
    return "发送失败";
  }
  return "待发送";
}

function getEventSubject(item: GuardianEvent) {
  if (item.ownership === "guardian") {
    return item.ward_display_name ?? item.ward_phone ?? "被监护人";
  }
  return item.guardian_name ?? "监护人";
}

function getBindingSubject(item: GuardianBinding) {
  if (item.ownership === "guardian") {
    return item.ward_display_name ?? item.ward_phone ?? "被监护人";
  }
  return item.guardian_display_name ?? item.guardian_name ?? "未命名";
}

function getBindingMeta(item: GuardianBinding) {
  if (item.ownership === "guardian") {
    return `${guardianRelationMeta[item.relation].label} · ${item.ward_phone ?? "未留手机号"}`;
  }
  return `${guardianRelationMeta[item.relation].label} · ${item.guardian_phone}`;
}

export default function GuardiansScreen() {
  const router = useRouter();
  const { token } = useAuth();
  const [bindings, setBindings] = useState<GuardianBinding[]>([]);
  const [events, setEvents] = useState<GuardianEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardianPhone, setGuardianPhone] = useState("");
  const [guardianName, setGuardianName] = useState("");
  const [relation, setRelation] = useState<GuardianBindingRelation>("parent");

  const loadAll = useCallback(async () => {
    if (!token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [bindingRows, eventRows] = await Promise.all([
        guardiansApi.listBindings(token),
        guardiansApi.listEvents(token, 12),
      ]);
      setBindings(bindingRows);
      setEvents(eventRows);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      void loadAll();
    }, [loadAll])
  );

  const wardBindings = useMemo(
    () => bindings.filter((item) => item.ownership === "ward" || item.ownership === "self"),
    [bindings]
  );
  const incomingBindings = useMemo(
    () => bindings.filter((item) => item.ownership === "guardian" && item.status === "pending"),
    [bindings]
  );
  const activeGuardianBindings = useMemo(
    () => bindings.filter((item) => item.ownership === "guardian" && item.status === "active"),
    [bindings]
  );
  const guardianAlerts = useMemo(
    () => events.filter((item) => item.ownership === "guardian" && item.notify_status === "sent"),
    [events]
  );

  const handleOpenEvent = useCallback(
    (eventId: string) => {
      router.push({
        pathname: "/guardians/events/[id]" as never,
        params: { id: eventId } as never,
      });
    },
    [router]
  );

  const handleCreate = useCallback(async () => {
    if (!token || submitting) {
      return;
    }
    if (!guardianPhone.trim()) {
      Alert.alert("缺少手机号", "请输入监护人手机号");
      return;
    }
    setSubmitting(true);
    try {
      await guardiansApi.createBinding(
        {
          guardian_phone: guardianPhone.trim(),
          guardian_name: guardianName.trim() || null,
          relation,
          is_primary: wardBindings.length === 0,
        },
        token
      );
      setGuardianPhone("");
      setGuardianName("");
      await loadAll();
    } catch (err) {
      Alert.alert("添加失败", err instanceof ApiError ? err.message : "请稍后重试");
    } finally {
      setSubmitting(false);
    }
  }, [guardianName, guardianPhone, loadAll, relation, submitting, token, wardBindings.length]);

  const handleConfirm = useCallback(
    async (bindingId: string) => {
      if (!token) {
        return;
      }
      setSubmitting(true);
      try {
        await guardiansApi.confirmBinding(bindingId, token);
        await loadAll();
      } catch (err) {
        Alert.alert("确认失败", err instanceof ApiError ? err.message : "请稍后重试");
      } finally {
        setSubmitting(false);
      }
    },
    [loadAll, token]
  );

  const handleRevoke = useCallback(
    async (bindingId: string) => {
      if (!token) {
        return;
      }
      setSubmitting(true);
      try {
        await guardiansApi.revokeBinding(bindingId, token);
        await loadAll();
      } catch (err) {
        Alert.alert("操作失败", err instanceof ApiError ? err.message : "请稍后重试");
      } finally {
        setSubmitting(false);
      }
    },
    [loadAll, token]
  );

  return (
    <View style={styles.root}>
      <AuthBackdrop />
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.headerCard}>
            <View style={styles.headerTop}>
              <Pressable
                style={({ pressed }) => [styles.backButton, pressed && styles.buttonPressed]}
                onPress={() => router.replace("/profile")}
              >
                <MaterialCommunityIcons name="chevron-left" size={22} color={palette.ink} />
              </Pressable>
              <View style={styles.headerCopy}>
                <Text style={styles.pageTitle}>监护人</Text>
                <Text style={styles.pageSubtitle}>绑定、确认、联动</Text>
              </View>
            </View>
          </View>

          <View style={styles.formCard}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>新增绑定</Text>
              {submitting ? <ActivityIndicator size="small" color={palette.accentStrong} /> : null}
            </View>
            <TextInput
              value={guardianPhone}
              onChangeText={setGuardianPhone}
              placeholder="手机号"
              placeholderTextColor={palette.lineStrong}
              keyboardType="phone-pad"
              style={styles.input}
            />
            <TextInput
              value={guardianName}
              onChangeText={setGuardianName}
              placeholder="称呼"
              placeholderTextColor={palette.lineStrong}
              style={styles.input}
            />
            <View style={styles.optionRow}>
              {relationOptions.map((item) => {
                const active = relation === item;
                return (
                  <Pressable
                    key={item}
                    onPress={() => setRelation(item)}
                    style={({ pressed }) => [
                      styles.optionChip,
                      active && styles.optionChipActive,
                      pressed && styles.buttonPressed,
                    ]}
                  >
                    <Text style={[styles.optionChipText, active && styles.optionChipTextActive]}>
                      {guardianRelationMeta[item].label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Pressable
              onPress={() => void handleCreate()}
              disabled={submitting}
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && styles.buttonPressed,
                submitting && styles.buttonDisabled,
              ]}
            >
              <MaterialCommunityIcons name="account-plus-outline" size={16} color={palette.inkInverse} />
              <Text style={styles.primaryButtonText}>添加</Text>
            </Pressable>
          </View>

          {incomingBindings.length ? (
            <View style={styles.sectionCard}>
              <Text style={styles.cardTitle}>待我确认</Text>
              <View style={styles.listColumn}>
                {incomingBindings.map((item) => (
                  <View key={item.id} style={styles.bindingCard}>
                    <View style={styles.bindingTop}>
                      <View>
                        <Text style={styles.bindingName}>{item.ward_display_name ?? "家人"}</Text>
                        <Text style={styles.bindingMeta}>
                          {guardianRelationMeta[item.relation].label} · {item.guardian_phone}
                        </Text>
                      </View>
                      <View style={styles.statusPill}>
                        <Text style={styles.statusPillText}>{getStatusLabel(item.status)}</Text>
                      </View>
                    </View>
                    <View style={styles.actionRow}>
                      <Pressable style={({ pressed }) => [styles.inlineButton, pressed && styles.buttonPressed]} onPress={() => void handleConfirm(item.id)}>
                        <Text style={styles.inlineButtonText}>确认</Text>
                      </Pressable>
                      <Pressable style={({ pressed }) => [styles.ghostButton, pressed && styles.buttonPressed]} onPress={() => void handleRevoke(item.id)}>
                        <Text style={styles.ghostButtonText}>拒绝</Text>
                      </Pressable>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {guardianAlerts.length ? (
            <View style={styles.sectionCard}>
              <Text style={styles.cardTitle}>待处理提醒</Text>
              <View style={styles.listColumn}>
                {guardianAlerts.slice(0, 3).map((item) => (
                  <Pressable
                    key={item.id}
                    onPress={() => handleOpenEvent(item.id)}
                    style={({ pressed }) => [styles.eventCard, pressed && styles.buttonPressed]}
                  >
                    <View style={styles.bindingTop}>
                      <View style={styles.bindingInfo}>
                        <Text style={styles.bindingName}>{getEventSubject(item)}</Text>
                        <Text style={styles.bindingMeta}>
                          {item.risk_level.toUpperCase()} · {item.summary}
                        </Text>
                      </View>
                      <View style={styles.statusPill}>
                        <Text style={styles.statusPillText}>待处理</Text>
                      </View>
                    </View>
                    <Text style={styles.bindingSubline}>{formatDateTime(item.created_at)}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}

          {activeGuardianBindings.length ? (
            <View style={styles.sectionCard}>
              <Text style={styles.cardTitle}>我在监护</Text>
              <View style={styles.listColumn}>
                {activeGuardianBindings.map((item) => (
                  <View key={item.id} style={styles.bindingCard}>
                    <View style={styles.bindingTop}>
                      <View style={styles.bindingInfo}>
                        <Text style={styles.bindingName}>{getBindingSubject(item)}</Text>
                        <Text style={styles.bindingMeta}>{getBindingMeta(item)}</Text>
                      </View>
                      <View style={styles.statusPill}>
                        <Text style={styles.statusPillText}>{getStatusLabel(item.status)}</Text>
                      </View>
                    </View>
                    <View style={styles.bindingBottom}>
                      <Text style={styles.bindingSubline}>
                        {item.is_primary ? "当前主监护" : "当前监护"} · {formatDateTime(item.updated_at)}
                      </Text>
                      <Pressable style={({ pressed }) => [styles.ghostButton, pressed && styles.buttonPressed]} onPress={() => void handleRevoke(item.id)}>
                        <Text style={styles.ghostButtonText}>退出</Text>
                      </Pressable>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          <View style={styles.sectionCard}>
            <Text style={styles.cardTitle}>我的绑定</Text>
            {loading ? (
              <View style={styles.loadingWrap}>
                <ActivityIndicator size="small" color={palette.accentStrong} />
              </View>
            ) : wardBindings.length ? (
              <View style={styles.listColumn}>
                {wardBindings.map((item) => (
                  <View key={item.id} style={styles.bindingCard}>
                    <View style={styles.bindingTop}>
                      <View style={styles.bindingInfo}>
                        <Text style={styles.bindingName}>{getBindingSubject(item)}</Text>
                        <Text style={styles.bindingMeta}>{getBindingMeta(item)}</Text>
                      </View>
                      <View style={styles.statusPill}>
                        <Text style={styles.statusPillText}>{getStatusLabel(item.status)}</Text>
                      </View>
                    </View>
                    <View style={styles.bindingBottom}>
                      <Text style={styles.bindingSubline}>
                        {item.is_primary ? "主联系人" : "备用联系人"} · {formatDateTime(item.updated_at)}
                      </Text>
                      <Pressable style={({ pressed }) => [styles.ghostButton, pressed && styles.buttonPressed]} onPress={() => void handleRevoke(item.id)}>
                        <Text style={styles.ghostButtonText}>解除</Text>
                      </Pressable>
                    </View>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.emptyText}>暂无绑定</Text>
            )}
          </View>

          <View style={styles.sectionCard}>
            <Text style={styles.cardTitle}>最近联动</Text>
            {events.length ? (
              <View style={styles.listColumn}>
                {events.map((item) => (
                  <Pressable
                    key={item.id}
                    onPress={() => handleOpenEvent(item.id)}
                    style={({ pressed }) => [styles.eventCard, pressed && styles.buttonPressed]}
                  >
                    <View style={styles.bindingTop}>
                      <View style={styles.bindingInfo}>
                        <Text style={styles.bindingName}>{item.summary}</Text>
                        <Text style={styles.bindingMeta}>
                          {getEventSubject(item)} · {getEventStatusLabel(item.notify_status)}
                        </Text>
                      </View>
                      <Text style={styles.eventRisk}>{item.risk_level.toUpperCase()}</Text>
                    </View>
                    <Text style={styles.bindingSubline}>{formatDateTime(item.created_at)}</Text>
                  </Pressable>
                ))}
              </View>
            ) : (
              <Text style={styles.emptyText}>暂无联动</Text>
            )}
          </View>

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
  content: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 24,
    gap: 16,
  },
  headerCard: {
    borderRadius: radius.xl,
    paddingHorizontal: 18,
    paddingVertical: 18,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    gap: 4,
    ...panelShadow,
  },
  headerTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  headerCopy: {
    flex: 1,
    gap: 4,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.surfaceSoft,
    borderWidth: 1,
    borderColor: palette.line,
  },
  pageTitle: {
    color: palette.ink,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  pageSubtitle: {
    color: palette.inkSoft,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  formCard: {
    borderRadius: radius.xl,
    padding: 16,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    gap: 12,
    ...panelShadow,
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
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cardTitle: {
    color: palette.ink,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  input: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.surfaceSoft,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: palette.ink,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: fontFamily.body,
  },
  optionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  optionChip: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.surfaceSoft,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  optionChipActive: {
    borderColor: palette.accentStrong,
    backgroundColor: palette.accentSoft,
  },
  optionChipText: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  optionChipTextActive: {
    color: palette.accentStrong,
  },
  primaryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: radius.pill,
    backgroundColor: palette.accentStrong,
    paddingVertical: 12,
  },
  primaryButtonText: {
    color: palette.inkInverse,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  buttonPressed: {
    opacity: 0.92,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  listColumn: {
    gap: 12,
  },
  bindingCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.surfaceSoft,
    padding: 14,
    gap: 12,
  },
  eventCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.surfaceSoft,
    padding: 14,
    gap: 8,
  },
  bindingTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  bindingInfo: {
    flex: 1,
    gap: 4,
  },
  bindingName: {
    color: palette.ink,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  bindingMeta: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fontFamily.body,
  },
  bindingBottom: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  bindingSubline: {
    color: palette.lineStrong,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fontFamily.body,
  },
  statusPill: {
    borderRadius: radius.pill,
    backgroundColor: palette.accentSoft,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statusPillText: {
    color: palette.accentStrong,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  eventRisk: {
    color: palette.accentStrong,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  actionRow: {
    flexDirection: "row",
    gap: 10,
  },
  inlineButton: {
    minWidth: 76,
    borderRadius: radius.pill,
    backgroundColor: palette.accentStrong,
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  inlineButtonText: {
    color: palette.inkInverse,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  ghostButton: {
    minWidth: 76,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.surface,
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  ghostButtonText: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  emptyText: {
    color: palette.inkSoft,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  loadingWrap: {
    paddingVertical: 8,
    alignItems: "center",
  },
  errorText: {
    color: palette.danger,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
});
