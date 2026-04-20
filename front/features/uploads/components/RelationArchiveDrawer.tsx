import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { relationTypeMeta, type RelationProfileSummary } from "@/features/relations/types";
import { resolveApiFileUrl } from "@/shared/api";
import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";
import { ManagedImage as Image } from "@/shared/ui/ManagedImage";

type Props = {
  relations: RelationProfileSummary[];
  activeRelationId: string | null;
  selectionCount: number;
  busy?: boolean;
  onSelectRelation: (relationId: string) => void;
  onClose: () => void;
  onArchive: () => void;
};

export default function RelationArchiveDrawer({
  relations,
  activeRelationId,
  selectionCount,
  busy = false,
  onSelectRelation,
  onClose,
  onArchive,
}: Props) {
  const activeMeta = activeRelationId
    ? relationTypeMeta[relations.find((item) => item.id === activeRelationId)?.relation_type ?? "family"]
    : null;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>选择关系</Text>
          <Text style={styles.subtitle}>{`已选 ${selectionCount} 项`}</Text>
        </View>
        <Pressable style={({ pressed }) => [styles.iconButton, pressed && styles.buttonPressed]} onPress={onClose}>
          <MaterialCommunityIcons name="close" size={18} color={palette.inkSoft} />
        </Pressable>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.list}>
        {relations.map((relation) => {
          const meta = relationTypeMeta[relation.relation_type];
          const active = relation.id === activeRelationId;
          const avatarUri = resolveApiFileUrl(relation.avatar_url);

          return (
            <Pressable
              key={relation.id}
              onPress={() => onSelectRelation(relation.id)}
              style={({ pressed }) => [
                styles.row,
                active && { borderColor: meta.accent, backgroundColor: meta.soft },
                pressed && styles.buttonPressed,
              ]}
            >
              {avatarUri ? (
                <Image source={{ uri: avatarUri }} style={styles.avatar} contentFit="cover" imagePreset="avatar" />
              ) : (
                <View style={[styles.avatarFallback, { backgroundColor: meta.soft }]}>
                  <MaterialCommunityIcons
                    name={meta.icon as keyof typeof MaterialCommunityIcons.glyphMap}
                    size={18}
                    color={meta.accent}
                  />
                </View>
              )}

              <Text style={styles.name} numberOfLines={1}>
                {relation.name}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <Pressable
        onPress={onArchive}
        disabled={!activeRelationId || busy}
        style={({ pressed }) => [
          styles.archiveButton,
          activeMeta && { backgroundColor: activeMeta.accent },
          (!activeRelationId || busy) && styles.archiveButtonDisabled,
          pressed && activeRelationId && !busy && styles.buttonPressed,
        ]}
      >
        <MaterialCommunityIcons name="archive-arrow-down-outline" size={17} color={palette.inkInverse} />
        <Text style={styles.archiveButtonText}>{busy ? "归档中" : "加入关系"}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    borderRadius: 28,
    backgroundColor: "rgba(255,255,255,0.96)",
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 12,
    ...panelShadow,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  headerCopy: {
    flex: 1,
    gap: 2,
  },
  title: {
    color: palette.ink,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  subtitle: {
    color: palette.inkSoft,
    fontSize: 11,
    lineHeight: 15,
    fontFamily: fontFamily.body,
  },
  iconButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.surfaceSoft,
  },
  list: {
    gap: 10,
    paddingBottom: 4,
  },
  row: {
    minHeight: 54,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.surfaceSoft,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: palette.backgroundDeep,
  },
  avatarFallback: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  name: {
    flex: 1,
    color: palette.ink,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  archiveButton: {
    minHeight: 44,
    borderRadius: radius.pill,
    backgroundColor: palette.accentStrong,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  archiveButtonDisabled: {
    opacity: 0.45,
  },
  archiveButtonText: {
    color: palette.inkInverse,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  buttonPressed: {
    opacity: 0.92,
  },
});
