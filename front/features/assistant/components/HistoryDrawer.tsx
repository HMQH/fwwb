import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, FadeOut, SlideInLeft, SlideOutLeft } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { fontFamily, palette, radius } from "@/shared/theme";

import type { AssistantSession } from "../types";

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--:--";
  }
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes()
  ).padStart(2, "0")}`;
}

type HistoryDrawerProps = {
  visible: boolean;
  sessions: AssistantSession[];
  activeSessionId?: string | null;
  relationNameMap: Record<string, string>;
  onClose: () => void;
  onOpenSession: (sessionId: string) => void;
  onCreateNew: () => void;
};

export default function HistoryDrawer({
  visible,
  sessions,
  activeSessionId,
  relationNameMap,
  onClose,
  onOpenSession,
  onCreateNew,
}: HistoryDrawerProps) {
  return (
    <Modal visible={visible} transparent animationType="none" presentationStyle="overFullScreen" onRequestClose={onClose}>
      <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)} style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} />

        <Animated.View entering={SlideInLeft.duration(180)} exiting={SlideOutLeft.duration(140)} style={styles.panelWrap}>
          <SafeAreaView edges={["top", "bottom"]} style={styles.panel}>
            <View style={styles.header}>
              <Text style={styles.title}>历史记录</Text>
              <Pressable style={({ pressed }) => [styles.newButton, pressed && styles.pressed]} onPress={onCreateNew}>
                <MaterialCommunityIcons name="plus" size={18} color={palette.ink} />
                <Text style={styles.newButtonText}>新对话</Text>
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.list}>
              {sessions.length ? (
                sessions.map((item) => {
                  const active = item.id === activeSessionId;
                  const relationName =
                    item.relation_profile_id && relationNameMap[item.relation_profile_id]
                      ? relationNameMap[item.relation_profile_id]
                      : null;
                  return (
                    <Pressable
                      key={item.id}
                      style={({ pressed }) => [
                        styles.sessionCard,
                        active && styles.sessionCardActive,
                        pressed && styles.pressed,
                      ]}
                      onPress={() => onOpenSession(item.id)}
                    >
                      <Text style={styles.sessionTitle} numberOfLines={1}>
                        {item.title || "新对话"}
                      </Text>
                      <View style={styles.sessionMetaRow}>
                        {relationName ? <Text style={styles.sessionMeta}>{relationName}</Text> : <View />}
                        <Text style={styles.sessionMeta}>{formatTime(item.updated_at)}</Text>
                      </View>
                    </Pressable>
                  );
                })
              ) : (
                <View style={styles.emptyState}>
                  <MaterialCommunityIcons name="message-text-outline" size={20} color={palette.inkSoft} />
                  <Text style={styles.emptyText}>暂无记录</Text>
                </View>
              )}
            </ScrollView>
          </SafeAreaView>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(19, 28, 43, 0.18)",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  panelWrap: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 296,
  },
  panel: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 20,
    shadowColor: "#BFD3F4",
    shadowOpacity: 0.28,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 18,
    minHeight: 40,
  },
  title: {
    color: palette.ink,
    fontSize: 20,
    lineHeight: 26,
    fontFamily: fontFamily.display,
    fontWeight: "800",
  },
  newButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: "#F4F7FC",
  },
  newButtonText: {
    color: palette.ink,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fontFamily.body,
    fontWeight: "700",
  },
  list: {
    gap: 10,
    paddingBottom: 12,
  },
  sessionCard: {
    borderRadius: 18,
    backgroundColor: "#F8FAFD",
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
  },
  sessionCardActive: {
    backgroundColor: "#EEF4FF",
  },
  sessionTitle: {
    color: "#1F2837",
    fontSize: 15,
    lineHeight: 20,
    fontFamily: fontFamily.body,
    fontWeight: "700",
  },
  sessionMetaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  sessionMeta: {
    color: "#9AA6B8",
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fontFamily.body,
  },
  emptyState: {
    paddingTop: 24,
    alignItems: "center",
    gap: 8,
  },
  emptyText: {
    color: palette.inkSoft,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  pressed: {
    opacity: 0.9,
  },
});
