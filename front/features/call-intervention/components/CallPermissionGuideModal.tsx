import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";

type GuideItem = {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  title: string;
  detail: string;
};

const permissionItems: GuideItem[] = [
  {
    icon: "phone-check-outline",
    title: "系统来电识别角色",
    detail: "来电时先识别号码风险。",
  },
  {
    icon: "phone-outline",
    title: "电话状态与联系人",
    detail: "识别号码与联系人命中。",
  },
  {
    icon: "dock-top",
    title: "悬浮提醒权限",
    detail: "后台显示圆形悬浮窗和风险提醒。",
  },
  {
    icon: "microphone-outline",
    title: "录音权限",
    detail: "仅在你主动开启免提录音后保存。",
  },
];

export function CallPermissionGuideModal({
  visible,
  onClose,
  onEnableDetection,
}: {
  visible: boolean;
  onClose: () => void;
  onEnableDetection: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.heroRow}>
            <View style={styles.heroBadge}>
              <MaterialCommunityIcons name="shield-alert-outline" size={18} color="#D65A3A" />
              <Text style={styles.heroBadgeText}>首次开启来电预警</Text>
            </View>
            <Pressable style={styles.closeButton} onPress={onClose}>
              <MaterialCommunityIcons name="close" size={18} color={palette.inkSoft} />
            </Pressable>
          </View>

          <Text style={styles.title}>先开启来电预警权限</Text>
          <Text style={styles.subtitle}>来电识别 / 悬浮提醒 / 录音</Text>

          <View style={styles.promiseCard}>
            <View style={styles.promiseRow}>
              <MaterialCommunityIcons name="check-decagram" size={16} color="#2D8C5B" />
              <Text style={styles.promiseTitle}>支持</Text>
            </View>
            <Text style={styles.promiseText}>识别来电风险、录音、转写、提醒。</Text>
            <View style={styles.promiseDivider} />
            <View style={styles.promiseRow}>
              <MaterialCommunityIcons name="shield-lock-outline" size={16} color={palette.accentStrong} />
              <Text style={styles.promiseTitle}>限制</Text>
            </View>
            <Text style={styles.promiseText}>不会绕过系统权限，也不会后台偷录。</Text>
          </View>

          <ScrollView contentContainerStyle={styles.permissionList} showsVerticalScrollIndicator={false}>
            {permissionItems.map((item) => (
              <View key={item.title} style={styles.permissionCard}>
                <View style={styles.permissionIconWrap}>
                  <MaterialCommunityIcons name={item.icon} size={20} color={palette.accentStrong} />
                </View>
                <View style={styles.permissionBody}>
                  <Text style={styles.permissionTitle}>{item.title}</Text>
                  <Text style={styles.permissionDetail}>{item.detail}</Text>
                </View>
              </View>
            ))}
          </ScrollView>

          <View style={styles.actionRow}>
            <Pressable style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed]} onPress={onEnableDetection}>
              <MaterialCommunityIcons name="shield-check-outline" size={18} color={palette.white} />
              <Text style={styles.primaryButtonText}>去开启</Text>
            </Pressable>
            <Pressable style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]} onPress={onClose}>
              <Text style={styles.secondaryButtonText}>稍后设置</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(15, 28, 46, 0.56)",
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  card: {
    borderRadius: radius.xl,
    backgroundColor: palette.surface,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 16,
    gap: 14,
    maxHeight: "90%",
    ...panelShadow,
  },
  heroRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  heroBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: "#FFF1EA",
  },
  heroBadgeText: {
    color: "#D65A3A",
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  closeButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.surfaceSoft,
  },
  title: {
    color: palette.ink,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  subtitle: {
    color: palette.inkSoft,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: fontFamily.body,
  },
  promiseCard: {
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 14,
    backgroundColor: "#F8FBFF",
    borderWidth: 1,
    borderColor: palette.line,
    gap: 8,
  },
  promiseRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  promiseTitle: {
    color: palette.ink,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  promiseText: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  promiseDivider: {
    height: 1,
    backgroundColor: palette.line,
    marginVertical: 2,
  },
  permissionList: {
    gap: 10,
  },
  permissionCard: {
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 14,
    backgroundColor: palette.surfaceSoft,
    borderWidth: 1,
    borderColor: palette.line,
    flexDirection: "row",
    gap: 12,
  },
  permissionIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.white,
  },
  permissionBody: {
    flex: 1,
    gap: 4,
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
  actionRow: {
    gap: 10,
  },
  primaryButton: {
    minHeight: 50,
    borderRadius: radius.pill,
    backgroundColor: palette.accentStrong,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  primaryButtonText: {
    color: palette.white,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  secondaryButton: {
    minHeight: 48,
    borderRadius: radius.pill,
    backgroundColor: palette.surfaceSoft,
    borderWidth: 1,
    borderColor: palette.line,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonText: {
    color: palette.inkSoft,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  buttonPressed: {
    opacity: 0.92,
  },
});
