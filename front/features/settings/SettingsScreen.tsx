import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useCallIntervention } from "@/features/call-intervention";
import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";

function PermissionRow({
  title,
  detail,
  active,
  onPress,
}: {
  title: string;
  detail: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <View style={styles.permissionRow}>
      <View style={styles.permissionCopy}>
        <View style={[styles.statusBadge, active ? styles.statusBadgeActive : styles.statusBadgePending]}>
          <Text style={[styles.statusBadgeText, active && styles.statusBadgeTextActive]}>{active ? "已开启" : "未开启"}</Text>
        </View>
        <Text style={styles.permissionTitle}>{title}</Text>
        <Text style={styles.permissionDetail}>{detail}</Text>
      </View>
      <Pressable style={({ pressed }) => [styles.enableButton, pressed && styles.buttonPressed]} onPress={onPress}>
        <Text style={styles.enableButtonText}>{active ? "重新检查" : "去开启"}</Text>
      </Pressable>
    </View>
  );
}

export default function SettingsScreen() {
  const router = useRouter();
  const {
    nativeDetectionStatus,
    refreshNativeDetectionStatus,
    requestRuntimeDetectionPermissions,
    requestCallScreeningRole,
    requestRecordingPermission,
    openOverlayPermissionSettings,
    prepareIncomingCallDetection,
    openPermissionGuide,
  } = useCallIntervention();

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Pressable style={({ pressed }) => [styles.backButton, pressed && styles.buttonPressed]} onPress={() => router.back()}>
            <MaterialCommunityIcons name="chevron-left" size={18} color={palette.accentStrong} />
            <Text style={styles.backText}>返回我的</Text>
          </Pressable>

          <View style={styles.headerCard}>
            <Text style={styles.pageTitle}>设置中心</Text>
            <Text style={styles.pageSubtitle}>来电识别 / 悬浮提醒 / 录音</Text>
            <View style={styles.headerActions}>
              <Pressable style={({ pressed }) => [styles.primaryAction, pressed && styles.buttonPressed]} onPress={() => void prepareIncomingCallDetection()}>
                <MaterialCommunityIcons name="shield-check-outline" size={18} color={palette.white} />
                <Text style={styles.primaryActionText}>一键开启</Text>
              </Pressable>
              <Pressable style={({ pressed }) => [styles.secondaryAction, pressed && styles.buttonPressed]} onPress={openPermissionGuide}>
                <Text style={styles.secondaryActionText}>查看权限说明</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>系统权限管理</Text>
              <Pressable onPress={() => void refreshNativeDetectionStatus()}>
                <Text style={styles.refreshText}>刷新状态</Text>
              </Pressable>
            </View>

            <PermissionRow
              title="系统来电识别"
              detail="来电时先识别号码风险。"
              active={nativeDetectionStatus.callScreeningEnabled}
              onPress={() => void requestCallScreeningRole()}
            />
            <PermissionRow
              title="电话状态与联系人"
              detail="识别号码与联系人命中。"
              active={nativeDetectionStatus.phoneStatePermissionGranted && nativeDetectionStatus.contactsPermissionGranted}
              onPress={() => void requestRuntimeDetectionPermissions()}
            />
            <PermissionRow
              title="悬浮提醒"
              detail="后台显示圆形悬浮窗与风险提醒。"
              active={nativeDetectionStatus.overlayPermissionGranted}
              onPress={() => void openOverlayPermissionSettings()}
            />
            <PermissionRow
              title="录音权限"
              detail="主动开启免提录音后保存音频并转写。"
              active={nativeDetectionStatus.recordAudioPermissionGranted}
              onPress={() => void requestRecordingPermission()}
            />
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>来电识别与录音</Text>
            <Text style={styles.cardDetail}>当前来电 / 实时转写 / 通话回看</Text>
            <Pressable style={({ pressed }) => [styles.primaryAction, pressed && styles.buttonPressed]} onPress={() => router.push("/call-intervention" as never)}>
              <MaterialCommunityIcons name="phone-settings-outline" size={18} color={palette.white} />
              <Text style={styles.primaryActionText}>进入来电识别与录音</Text>
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
    paddingTop: 8,
    paddingBottom: 28,
    gap: 14,
  },
  backButton: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: radius.pill,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
  },
  backText: {
    color: palette.accentStrong,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  headerCard: {
    borderRadius: radius.xl,
    paddingHorizontal: 18,
    paddingVertical: 18,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    gap: 12,
    ...panelShadow,
  },
  pageTitle: {
    color: palette.ink,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  pageSubtitle: {
    color: palette.inkSoft,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: fontFamily.body,
  },
  headerActions: {
    gap: 10,
  },
  card: {
    borderRadius: radius.lg,
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    gap: 12,
    ...panelShadow,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  cardTitle: {
    color: palette.ink,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  cardDetail: {
    color: palette.inkSoft,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: fontFamily.body,
  },
  refreshText: {
    color: palette.accentStrong,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  permissionRow: {
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 14,
    backgroundColor: palette.surfaceSoft,
    borderWidth: 1,
    borderColor: palette.line,
    gap: 10,
  },
  permissionCopy: {
    gap: 4,
  },
  statusBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: "#FFF2E6",
  },
  statusBadgeActive: {
    backgroundColor: "#EAF8F0",
  },
  statusBadgePending: {
    backgroundColor: "#FFF2E6",
  },
  statusBadgeText: {
    color: "#C27A2E",
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  statusBadgeTextActive: {
    color: "#2D8C5B",
  },
  permissionTitle: {
    color: palette.ink,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  permissionDetail: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  enableButton: {
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: radius.pill,
    backgroundColor: palette.white,
    borderWidth: 1,
    borderColor: palette.line,
  },
  enableButtonText: {
    color: palette.accentStrong,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  primaryAction: {
    minHeight: 48,
    borderRadius: radius.pill,
    backgroundColor: palette.accentStrong,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  primaryActionText: {
    color: palette.white,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  secondaryAction: {
    minHeight: 46,
    borderRadius: radius.pill,
    backgroundColor: palette.surfaceSoft,
    borderWidth: 1,
    borderColor: palette.line,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryActionText: {
    color: palette.inkSoft,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  buttonPressed: {
    opacity: 0.92,
  },
});
