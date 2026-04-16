import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";

import type { GuardianNotificationPreview } from "../notification-service";

type Props = {
  visible: boolean;
  event: GuardianNotificationPreview | null;
  onDismiss: () => void;
  onView: () => void;
};

function getRiskLabel(level?: string) {
  if (level === "high") {
    return "高风险";
  }
  if (level === "medium") {
    return "中风险";
  }
  return "风险提醒";
}

export default function GuardianRiskPrompt({ visible, event, onDismiss, onView }: Props) {
  if (!event) {
    return null;
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      presentationStyle="overFullScreen"
      onRequestClose={onDismiss}
    >
      <SafeAreaView style={styles.overlay} edges={["top", "bottom"]}>
        <Pressable style={styles.scrim} onPress={onDismiss} />
        <View style={styles.sheetWrap} pointerEvents="box-none">
          <View style={styles.card}>
            <LinearGradient
              colors={["#EAF3FF", "#FFFFFF"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.gradient}
            >
              <View style={styles.headerRow}>
                <View style={styles.iconWrap}>
                  <MaterialCommunityIcons name="shield-alert-outline" size={22} color={palette.accentStrong} />
                </View>
                <View style={styles.headerCopy}>
                  <Text style={styles.eyebrow}>监护预警</Text>
                  <Text style={styles.title}>{event.ward_display_name ?? "被监护人"}</Text>
                </View>
                <View style={styles.riskPill}>
                  <Text style={styles.riskPillText}>{getRiskLabel(event.risk_level)}</Text>
                </View>
              </View>

              <View style={styles.summaryCard}>
                <Text style={styles.summaryLabel}>刚刚检测到异常</Text>
                <Text style={styles.summaryText}>{event.summary}</Text>
              </View>

              <View style={styles.metaRow}>
                <View style={styles.metaChip}>
                  <MaterialCommunityIcons name="bell-ring-outline" size={14} color={palette.accentStrong} />
                  <Text style={styles.metaChipText}>系统通知已送达</Text>
                </View>
                <View style={styles.metaChip}>
                  <MaterialCommunityIcons name="flash-outline" size={14} color={palette.accentStrong} />
                  <Text style={styles.metaChipText}>建议立即处理</Text>
                </View>
              </View>

              <View style={styles.actionRow}>
                <Pressable style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]} onPress={onDismiss}>
                  <Text style={styles.secondaryButtonText}>稍后处理</Text>
                </Pressable>
                <Pressable style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed]} onPress={onView}>
                  <MaterialCommunityIcons name="arrow-right" size={16} color={palette.inkInverse} />
                  <Text style={styles.primaryButtonText}>立即查看</Text>
                </Pressable>
              </View>
            </LinearGradient>
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(17, 34, 68, 0.26)",
  },
  sheetWrap: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  card: {
    borderRadius: radius.xl,
    overflow: "hidden",
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    ...panelShadow,
  },
  gradient: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 18,
    gap: 16,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  iconWrap: {
    width: 46,
    height: 46,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.accentSoft,
  },
  headerCopy: {
    flex: 1,
    gap: 2,
  },
  eyebrow: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fontFamily.body,
  },
  title: {
    color: palette.ink,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  riskPill: {
    borderRadius: radius.pill,
    backgroundColor: palette.accentStrong,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  riskPillText: {
    color: palette.inkInverse,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  summaryCard: {
    borderRadius: radius.lg,
    backgroundColor: "rgba(255,255,255,0.82)",
    borderWidth: 1,
    borderColor: palette.line,
    padding: 14,
    gap: 6,
  },
  summaryLabel: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fontFamily.body,
  },
  summaryText: {
    color: palette.ink,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  metaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: palette.surfaceSoft,
    borderWidth: 1,
    borderColor: palette.line,
  },
  metaChipText: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  actionRow: {
    flexDirection: "row",
    gap: 12,
  },
  secondaryButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.surface,
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
  primaryButton: {
    flex: 1.2,
    minHeight: 48,
    borderRadius: radius.pill,
    backgroundColor: palette.accentStrong,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
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
});
