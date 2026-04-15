import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, FadeOut, SlideInUp, SlideOutDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { relationTypeMeta, type RelationProfileSummary } from "@/features/relations/types";
import { fontFamily, palette, radius } from "@/shared/theme";

type RelationPickerSheetProps = {
  visible: boolean;
  relations: RelationProfileSummary[];
  selectedRelationId: string | null;
  onClose: () => void;
  onSelect: (relationId: string | null) => void;
};

export default function RelationPickerSheet({
  visible,
  relations,
  selectedRelationId,
  onClose,
  onSelect,
}: RelationPickerSheetProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      presentationStyle="overFullScreen"
      onRequestClose={onClose}
    >
      <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)} style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} />

        <SafeAreaView edges={["bottom"]} style={styles.safeArea}>
          <Animated.View entering={SlideInUp.duration(220)} exiting={SlideOutDown.duration(160)} style={styles.sheet}>
            <View style={styles.handle} />

            <View style={styles.header}>
              <Text style={styles.title}>选择对象</Text>
              <Pressable style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]} onPress={onClose}>
                <MaterialCommunityIcons name="close" size={18} color={palette.ink} />
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.list}>
              <Pressable
                style={({ pressed }) => [
                  styles.option,
                  selectedRelationId === null && styles.optionActive,
                  pressed && styles.pressed,
                ]}
                onPress={() => onSelect(null)}
              >
                <View style={styles.optionMain}>
                  <View style={[styles.iconWrap, styles.defaultIconWrap]}>
                    <MaterialCommunityIcons name="shield-check-outline" size={18} color={palette.accentStrong} />
                  </View>
                  <View style={styles.optionTextWrap}>
                    <Text style={styles.optionTitle}>默认对象</Text>
                    <Text style={styles.optionMeta}>通用分析</Text>
                  </View>
                </View>
                {selectedRelationId === null ? (
                  <MaterialCommunityIcons name="check-circle" size={18} color={palette.accentStrong} />
                ) : null}
              </Pressable>

              {relations.map((item) => {
                const active = item.id === selectedRelationId;
                const meta = relationTypeMeta[item.relation_type];
                return (
                  <Pressable
                    key={item.id}
                    style={({ pressed }) => [styles.option, active && styles.optionActive, pressed && styles.pressed]}
                    onPress={() => onSelect(item.id)}
                  >
                    <View style={styles.optionMain}>
                      <View style={[styles.iconWrap, { backgroundColor: meta.soft }]}>
                        <MaterialCommunityIcons name={meta.icon as never} size={18} color={meta.accent} />
                      </View>
                      <View style={styles.optionTextWrap}>
                        <Text style={styles.optionTitle}>{item.name}</Text>
                        <Text style={styles.optionMeta}>{meta.label}</Text>
                      </View>
                    </View>
                    {active ? <MaterialCommunityIcons name="check-circle" size={18} color={palette.accentStrong} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Animated.View>
        </SafeAreaView>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(19, 28, 43, 0.18)",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  safeArea: {
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 12,
    shadowColor: "#BFD3F4",
    shadowOpacity: 0.22,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: -8 },
    elevation: 16,
    minHeight: 280,
    maxHeight: "72%",
  },
  handle: {
    alignSelf: "center",
    width: 42,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: "#D7E4F5",
    marginBottom: 14,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  title: {
    color: palette.ink,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "800",
    fontFamily: fontFamily.display,
  },
  closeButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F4F7FC",
  },
  list: {
    gap: 10,
    paddingBottom: 10,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 20,
    backgroundColor: "#F8FAFD",
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  optionActive: {
    backgroundColor: "#EEF4FF",
  },
  optionMain: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  defaultIconWrap: {
    backgroundColor: "#EAF2FF",
  },
  optionTextWrap: {
    gap: 3,
    flex: 1,
  },
  optionTitle: {
    color: "#1F2837",
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "700",
    fontFamily: fontFamily.body,
  },
  optionMeta: {
    color: "#8FA0B5",
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fontFamily.body,
  },
  pressed: {
    opacity: 0.88,
  },
});
