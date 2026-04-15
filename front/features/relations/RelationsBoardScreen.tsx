import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import Animated, { FadeInDown, FadeInUp } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth, type LocalImageAsset } from "@/features/auth";
import { ApiError } from "@/shared/api";
import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";

import { relationsApi } from "./api";
import RelationCard from "./components/RelationCard";
import type { RelationProfileSummary, RelationType } from "./types";
import { relationTypeMeta } from "./types";

const RELATION_TYPES = Object.keys(relationTypeMeta) as RelationType[];
const CONTENT_HORIZONTAL = 12;
const RELATION_GAP = 2;

function normalizeTags(raw: string) {
  return raw
    .split(/[\s,，、]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 6);
}

export default function RelationsBoardScreen() {
  const router = useRouter();
  const { token } = useAuth();
  const { width, height } = useWindowDimensions();

  const [relations, setRelations] = useState<RelationProfileSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sheetVisible, setSheetVisible] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draftType, setDraftType] = useState<RelationType>("family");
  const [draftName, setDraftName] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftTags, setDraftTags] = useState("");
  const [draftAvatar, setDraftAvatar] = useState<LocalImageAsset | null>(null);

  const loadRelations = useCallback(async () => {
    if (!token) {
      setRelations([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await relationsApi.list(token);
      setRelations(response);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      void loadRelations();
    }, [loadRelations])
  );

  const summary = useMemo(() => {
    return relations.reduce(
      (acc, item) => {
        acc.files += item.bound_file_count;
        acc.shortTerm += item.short_term_count;
        acc.longTerm += item.long_term_count;
        return acc;
      },
      { files: 0, shortTerm: 0, longTerm: 0 }
    );
  }, [relations]);

  const relationColumns = width >= 350 ? 3 : 2;
  const relationGridWidth = width - CONTENT_HORIZONTAL * 2;
  const relationTileSize = Math.max(
    104,
    Math.floor((relationGridWidth - RELATION_GAP * (relationColumns - 1)) / relationColumns)
  );

  const resetDraft = useCallback(() => {
    setDraftType("family");
    setDraftName("");
    setDraftDescription("");
    setDraftTags("");
    setDraftAvatar(null);
  }, []);

  const handlePickAvatar = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("需要相册权限", "请先允许访问相册");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.88,
    });

    if (result.canceled || !result.assets[0]) {
      return;
    }

    const asset = result.assets[0];
    setDraftAvatar({
      uri: asset.uri,
      name: asset.fileName?.trim() || `relation-${Date.now()}.jpg`,
      mimeType: asset.mimeType || "image/jpeg",
    });
  }, []);

  const handleCreateRelation = useCallback(async () => {
    if (!token) {
      return;
    }

    if (!draftName.trim()) {
      Alert.alert("缺少名字", "先输入联系人名字");
      return;
    }

    setCreating(true);
    try {
      const created = await relationsApi.create(
        {
          relation_type: draftType,
          name: draftName.trim(),
          description: draftDescription.trim() || undefined,
          tags: normalizeTags(draftTags),
        },
        token
      );

      if (draftAvatar) {
        await relationsApi.uploadAvatar(created.id, draftAvatar, token);
      }

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      setSheetVisible(false);
      resetDraft();
      await loadRelations();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "创建失败";
      Alert.alert("创建失败", message);
    } finally {
      setCreating(false);
    }
  }, [draftAvatar, draftDescription, draftName, draftTags, draftType, loadRelations, resetDraft, token]);

  return (
    <View style={styles.root}>
      <View style={styles.backgroundOrbTop} />
      <View style={styles.backgroundOrbBottom} />
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Animated.View entering={FadeInDown.duration(260)} style={styles.topBar}>
            <Pressable style={({ pressed }) => [styles.iconButton, pressed && styles.buttonPressed]} onPress={() => router.push("/profile")}>
              <MaterialCommunityIcons name="chevron-left" size={20} color={palette.accentStrong} />
            </Pressable>
            <View style={styles.titleBlock}>
              <Text style={styles.pageTitle}>{"关系记忆"}</Text>
              <Text style={styles.pageSubtitle}>{"联系人卡片"}</Text>
            </View>
            <Pressable style={({ pressed }) => [styles.addButton, pressed && styles.buttonPressed]} onPress={() => setSheetVisible(true)}>
              <MaterialCommunityIcons name="plus" size={20} color={palette.inkInverse} />
            </Pressable>
          </Animated.View>

          <Animated.View entering={FadeInUp.duration(280).delay(40)} style={styles.metricRow}>
            <View style={styles.metricCard}>
              <Text style={styles.metricValue}>{relations.length}</Text>
              <Text style={styles.metricLabel}>{"关系"}</Text>
            </View>
            <View style={styles.metricCard}>
              <Text style={styles.metricValue}>{summary.files}</Text>
              <Text style={styles.metricLabel}>{"归档"}</Text>
            </View>
            <View style={styles.metricCard}>
              <Text style={styles.metricValue}>{summary.shortTerm + summary.longTerm}</Text>
              <Text style={styles.metricLabel}>{"记忆"}</Text>
            </View>
          </Animated.View>

          {loading ? (
            <View style={styles.stateCard}>
              <ActivityIndicator size="small" color={palette.accentStrong} />
              <Text style={styles.stateText}>{"加载中"}</Text>
            </View>
          ) : error ? (
            <View style={styles.stateCard}>
              <Text style={styles.stateTitle}>{"加载失败"}</Text>
              <Text style={styles.stateText}>{error}</Text>
            </View>
          ) : !relations.length ? (
            <View style={styles.emptyCard}>
              <MaterialCommunityIcons name="account-plus-outline" size={26} color={palette.accentStrong} />
              <Text style={styles.emptyTitle}>{"还没有关系卡"}</Text>
              <Pressable style={({ pressed }) => [styles.emptyAction, pressed && styles.buttonPressed]} onPress={() => setSheetVisible(true)}>
                <Text style={styles.emptyActionText}>{"新建"}</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.grid}>
              {relations.map((relation, index) => (
                <Animated.View
                  key={relation.id}
                  entering={FadeInUp.duration(260).delay(50 + index * 40)}
                  style={[styles.gridCell, { width: relationTileSize, height: relationTileSize }]}
                >
                  <RelationCard
                    relation={relation}
                    size={relationTileSize}
                    onPress={() => router.push({ pathname: "/relations/[id]", params: { id: relation.id } } as never)}
                  />
                </Animated.View>
              ))}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>

      <Modal transparent visible={sheetVisible} animationType="fade" onRequestClose={() => setSheetVisible(false)}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={() => setSheetVisible(false)} />
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "position"}
            keyboardVerticalOffset={Platform.OS === "ios" ? 12 : 20}
            style={styles.sheetHost}
          >
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.sheetScrollHost}
            >
            <View style={[styles.sheetCard, { maxHeight: height * 0.76 }]}>
              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>{"新建关系"}</Text>
                <Pressable style={({ pressed }) => [styles.sheetIconButton, pressed && styles.buttonPressed]} onPress={() => setSheetVisible(false)}>
                  <MaterialCommunityIcons name="close" size={18} color={palette.inkSoft} />
                </Pressable>
              </View>

              <Pressable style={styles.avatarPicker} onPress={() => void handlePickAvatar()}>
                {draftAvatar ? (
                  <Image source={{ uri: draftAvatar.uri }} style={styles.avatarPreview} contentFit="cover" />
                ) : (
                  <View style={styles.avatarPlaceholder}>
                    <MaterialCommunityIcons name="camera-plus-outline" size={20} color={palette.accentStrong} />
                  </View>
                )}
                <Text style={styles.avatarPickerText}>{draftAvatar ? "换头像" : "加头像"}</Text>
              </Pressable>

              <View style={styles.typeRow}>
                {RELATION_TYPES.map((type) => {
                  const meta = relationTypeMeta[type];
                  const active = draftType === type;
                  return (
                    <Pressable key={type} onPress={() => setDraftType(type)} style={[styles.typeChip, active && { backgroundColor: meta.soft, borderColor: meta.accent }]}>
                      <Text style={[styles.typeChipText, active && { color: meta.accent }]}>{meta.label}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <TextInput value={draftName} onChangeText={setDraftName} placeholder={"名字"} placeholderTextColor={palette.lineStrong} style={styles.input} />
              <TextInput value={draftDescription} onChangeText={setDraftDescription} placeholder={"描述"} placeholderTextColor={palette.lineStrong} style={[styles.input, styles.inputMultiline]} multiline />
              <TextInput value={draftTags} onChangeText={setDraftTags} placeholder={"标签"} placeholderTextColor={palette.lineStrong} style={styles.input} />

              <Pressable onPress={() => void handleCreateRelation()} disabled={creating} style={({ pressed }) => [styles.createButton, pressed && styles.buttonPressed, creating && styles.buttonDisabled]}>
                <Text style={styles.createButtonText}>{creating ? "创建中" : "创建"}</Text>
              </Pressable>
            </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.background },
  safeArea: { flex: 1 },
  content: { paddingHorizontal: CONTENT_HORIZONTAL, paddingTop: 8, paddingBottom: 28, gap: 10 },
  backgroundOrbTop: {
    position: "absolute",
    top: -120,
    left: -48,
    width: 260,
    height: 260,
    borderRadius: 999,
    backgroundColor: "rgba(117, 167, 255, 0.14)",
  },
  backgroundOrbBottom: {
    position: "absolute",
    right: -86,
    bottom: 80,
    width: 240,
    height: 240,
    borderRadius: 999,
    backgroundColor: "rgba(196, 218, 255, 0.18)",
  },
  topBar: { flexDirection: "row", alignItems: "center", gap: 12 },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    alignItems: "center",
    justifyContent: "center",
  },
  titleBlock: { flex: 1, gap: 2 },
  pageTitle: { color: palette.ink, fontSize: 24, lineHeight: 30, fontWeight: "900", fontFamily: fontFamily.display },
  pageSubtitle: { color: palette.inkSoft, fontSize: 12, lineHeight: 16, fontFamily: fontFamily.body },
  addButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: palette.accentStrong,
    alignItems: "center",
    justifyContent: "center",
    ...panelShadow,
  },
  metricRow: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: radius.xl,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    ...panelShadow,
  },
  metricCard: { flex: 1, borderRadius: radius.md, backgroundColor: palette.surfaceSoft, paddingHorizontal: 12, paddingVertical: 12, gap: 4 },
  metricValue: { color: palette.ink, fontSize: 18, lineHeight: 24, fontWeight: "900", fontFamily: fontFamily.display },
  metricLabel: { color: palette.inkSoft, fontSize: 11, lineHeight: 14, fontFamily: fontFamily.body },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: RELATION_GAP },
  gridCell: { overflow: "hidden" },
  stateCard: {
    borderRadius: radius.lg,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 18,
    paddingVertical: 20,
    gap: 8,
    alignItems: "center",
    ...panelShadow,
  },
  stateTitle: { color: palette.ink, fontSize: 16, lineHeight: 22, fontWeight: "900", fontFamily: fontFamily.display },
  stateText: { color: palette.inkSoft, fontSize: 13, lineHeight: 18, fontFamily: fontFamily.body },
  emptyCard: {
    borderRadius: radius.xl,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 18,
    paddingVertical: 26,
    gap: 12,
    alignItems: "center",
    ...panelShadow,
  },
  emptyTitle: { color: palette.ink, fontSize: 18, lineHeight: 24, fontWeight: "900", fontFamily: fontFamily.display },
  emptyAction: { minHeight: 42, borderRadius: radius.pill, backgroundColor: palette.accentStrong, paddingHorizontal: 18, alignItems: "center", justifyContent: "center" },
  emptyActionText: { color: palette.inkInverse, fontSize: 13, lineHeight: 18, fontWeight: "800", fontFamily: fontFamily.body },
  modalRoot: { flex: 1, justifyContent: "flex-end" },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(21, 42, 72, 0.32)" },
  sheetHost: { justifyContent: "flex-end" },
  sheetScrollHost: { justifyContent: "flex-end", flexGrow: 1 },
  sheetCard: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    backgroundColor: palette.surface,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 28,
    gap: 12,
  },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sheetTitle: { color: palette.ink, fontSize: 18, lineHeight: 24, fontWeight: "900", fontFamily: fontFamily.display },
  sheetIconButton: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: palette.surfaceSoft },
  avatarPicker: { flexDirection: "row", alignItems: "center", gap: 10 },
  avatarPreview: { width: 56, height: 56, borderRadius: 18, backgroundColor: palette.backgroundDeep },
  avatarPlaceholder: { width: 56, height: 56, borderRadius: 18, backgroundColor: palette.accentSoft, alignItems: "center", justifyContent: "center" },
  avatarPickerText: { color: palette.accentStrong, fontSize: 13, lineHeight: 18, fontWeight: "800", fontFamily: fontFamily.body },
  typeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  typeChip: { borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: palette.surfaceSoft, borderWidth: 1, borderColor: palette.line },
  typeChipText: { color: palette.inkSoft, fontSize: 12, lineHeight: 16, fontWeight: "700", fontFamily: fontFamily.body },
  input: { minHeight: 44, borderRadius: radius.md, backgroundColor: palette.surfaceSoft, borderWidth: 1, borderColor: palette.line, paddingHorizontal: 14, color: palette.ink, fontSize: 14, lineHeight: 20, fontFamily: fontFamily.body },
  inputMultiline: { minHeight: 84, paddingTop: 12, paddingBottom: 12, textAlignVertical: "top" },
  createButton: { minHeight: 44, borderRadius: radius.pill, backgroundColor: palette.accentStrong, alignItems: "center", justifyContent: "center" },
  createButtonText: { color: palette.inkInverse, fontSize: 14, lineHeight: 20, fontWeight: "800", fontFamily: fontFamily.body },
  buttonPressed: { opacity: 0.92 },
  buttonDisabled: { opacity: 0.6 },
});
