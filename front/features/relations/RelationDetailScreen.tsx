import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
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
  View,
  useWindowDimensions,
} from "react-native";
import Animated, { FadeInUp } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth, type LocalImageAsset } from "@/features/auth";
import { flattenRelationUploads, formatAssetTime, type GalleryAsset } from "@/features/uploads/asset-utils";
import AssetPreviewModal from "@/features/uploads/components/AssetPreviewModal";
import UploadAssetTile from "@/features/uploads/components/UploadAssetTile";
import { ApiError, resolveApiFileUrl } from "@/shared/api";
import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";

import { relationsApi } from "./api";
import type { MemoryScope, RelationDetail, RelationMemory } from "./types";
import { memoryScopeMeta, relationTypeMeta } from "./types";

type DetailTab = "materials" | "short_term" | "long_term";

const TAB_OPTIONS: Array<{ key: DetailTab; label: string }> = [
  { key: "materials", label: "素材" },
  { key: "short_term", label: "短期" },
  { key: "long_term", label: "长期" },
];

const CONTENT_HORIZONTAL = 12;
const MATERIAL_GAP = 1;

function formatDateTime(value?: string | null) {
  if (!value) {
    return "--";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export default function RelationDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { token } = useAuth();
  const { width, height } = useWindowDimensions();

  const [detail, setDetail] = useState<RelationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<DetailTab>("materials");
  const [composerVisible, setComposerVisible] = useState(false);
  const [scope, setScope] = useState<MemoryScope>("short_term");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [creating, setCreating] = useState(false);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [updatingAvatar, setUpdatingAvatar] = useState(false);
  const [previewAsset, setPreviewAsset] = useState<GalleryAsset | null>(null);

  const loadDetail = useCallback(async () => {
    if (!token || !id) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await relationsApi.detail(id, token);
      setDetail(response);
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

  const relationMeta = useMemo(() => {
    if (!detail) {
      return null;
    }
    return relationTypeMeta[detail.profile.relation_type];
  }, [detail]);

  const materialAssets = useMemo(() => {
    if (!detail) {
      return [];
    }
    return flattenRelationUploads(detail.linked_uploads);
  }, [detail]);

  const stageHeight = Math.max(340, Math.min(500, height * 0.58));
  const materialContentWidth = width - CONTENT_HORIZONTAL * 2 - 2;
  const materialColumns = Math.max(
    3,
    Math.min(5, Math.floor((materialContentWidth + MATERIAL_GAP) / (84 + MATERIAL_GAP)))
  );
  const materialTileSize = Math.max(
    86,
    Math.floor((materialContentWidth - MATERIAL_GAP * (materialColumns - 1)) / materialColumns)
  );

  const handlePickAvatar = useCallback(async () => {
    if (!token || !detail) {
      return;
    }

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
    const file: LocalImageAsset = {
      uri: asset.uri,
      name: asset.fileName?.trim() || `relation-${Date.now()}.jpg`,
      mimeType: asset.mimeType || "image/jpeg",
    };

    setUpdatingAvatar(true);
    try {
      await relationsApi.uploadAvatar(detail.profile.id, file, token);
      await loadDetail();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "头像上传失败";
      Alert.alert("上传失败", message);
    } finally {
      setUpdatingAvatar(false);
    }
  }, [detail, loadDetail, token]);

  const handleCreateMemory = useCallback(async () => {
    if (!token || !id) {
      return;
    }

    if (!title.trim() || !content.trim()) {
      Alert.alert("缺少内容", "先填写标题和内容");
      return;
    }

    setCreating(true);
    try {
      await relationsApi.createMemory(
        id,
        {
          memory_scope: scope,
          memory_kind: "note",
          title: title.trim(),
          content: content.trim(),
        },
        token
      );
      setComposerVisible(false);
      setTitle("");
      setContent("");
      setScope("short_term");
      await loadDetail();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "保存失败";
      Alert.alert("保存失败", message);
    } finally {
      setCreating(false);
    }
  }, [content, id, loadDetail, scope, title, token]);

  const handleMoveMemory = useCallback(
    async (memory: RelationMemory, nextScope: MemoryScope) => {
      if (!token || !id || memory.memory_scope === nextScope) {
        return;
      }

      setMovingId(memory.id);
      try {
        await relationsApi.updateMemoryScope(id, memory.id, { memory_scope: nextScope }, token);
        await loadDetail();
      } catch (err) {
        const message = err instanceof ApiError ? err.message : "移动失败";
        Alert.alert("移动失败", message);
      } finally {
        setMovingId(null);
      }
    },
    [id, loadDetail, token]
  );

  const renderMemoryList = (items: RelationMemory[], columnScope: MemoryScope) => {
    const nextScope: MemoryScope = columnScope === "short_term" ? "long_term" : "short_term";

    if (!items.length) {
      return (
        <View style={styles.emptyStageCard}>
          <Text style={styles.emptyStageText}>{`暂无${memoryScopeMeta[columnScope].label}`}</Text>
        </View>
      );
    }

    return (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.memoryList}>
        {items.map((item) => (
          <View key={item.id} style={styles.memoryCard}>
            <View style={styles.memoryTop}>
              <View style={styles.memoryCopy}>
                <Text style={styles.memoryTitle} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={styles.memoryTime}>{formatDateTime(item.happened_at ?? item.created_at)}</Text>
              </View>

              <Pressable
                onPress={() => void handleMoveMemory(item, nextScope)}
                disabled={movingId === item.id}
                style={({ pressed }) => [styles.swapButton, pressed && styles.buttonPressed]}
              >
                <MaterialCommunityIcons name="swap-horizontal" size={16} color={palette.accentStrong} />
              </Pressable>
            </View>

            <Text style={styles.memoryContent}>{item.content}</Text>
          </View>
        ))}
      </ScrollView>
    );
  };

  const avatarUri = detail?.profile.avatar_url ? resolveApiFileUrl(detail.profile.avatar_url) : null;

  return (
    <View style={styles.root}>
      <View style={styles.backgroundOrbTop} />
      <View style={styles.backgroundOrbBottom} />

      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Animated.View entering={FadeInUp.duration(180)} style={styles.topBar}>
            <Pressable style={({ pressed }) => [styles.iconButton, pressed && styles.buttonPressed]} onPress={() => router.push("/relations")}>
              <MaterialCommunityIcons name="chevron-left" size={20} color={palette.accentStrong} />
            </Pressable>

            <View style={styles.titleBlock}>
              <Text style={styles.pageTitle}>关系详情</Text>
              <Text style={styles.pageSubtitle}>素材优先</Text>
            </View>

            <Pressable style={({ pressed }) => [styles.addButton, pressed && styles.buttonPressed]} onPress={() => setComposerVisible(true)}>
              <MaterialCommunityIcons name="plus" size={20} color={palette.inkInverse} />
            </Pressable>
          </Animated.View>

          {loading ? (
            <View style={styles.stateCard}>
              <ActivityIndicator size="small" color={palette.accentStrong} />
              <Text style={styles.stateText}>加载中</Text>
            </View>
          ) : error ? (
            <View style={styles.stateCard}>
              <Text style={styles.stateTitle}>加载失败</Text>
              <Text style={styles.stateText}>{error}</Text>
            </View>
          ) : !detail || !relationMeta ? (
            <View style={styles.stateCard}>
              <Text style={styles.stateTitle}>暂无内容</Text>
            </View>
          ) : (
            <>
              <Animated.View entering={FadeInUp.duration(180).delay(20)} style={styles.heroCard}>
                <View style={styles.heroTop}>
                  <Pressable onPress={() => void handlePickAvatar()} style={styles.avatarButton}>
                    {avatarUri ? (
                      <Image source={{ uri: avatarUri }} style={styles.avatar} contentFit="cover" />
                    ) : (
                      <View style={[styles.avatarFallback, { backgroundColor: relationMeta.soft }]}>
                        <MaterialCommunityIcons
                          name={relationMeta.icon as keyof typeof MaterialCommunityIcons.glyphMap}
                          size={22}
                          color={relationMeta.accent}
                        />
                      </View>
                    )}

                    {updatingAvatar ? (
                      <View style={styles.avatarLoading}>
                        <ActivityIndicator size="small" color={palette.white} />
                      </View>
                    ) : null}
                  </Pressable>

                  <View style={styles.heroCopy}>
                    <Text style={styles.heroName}>{detail.profile.name}</Text>
                    <View style={[styles.heroTypeBadge, { backgroundColor: relationMeta.soft }]}>
                      <Text style={[styles.heroTypeText, { color: relationMeta.accent }]}>{relationMeta.label}</Text>
                    </View>
                    {!!detail.profile.description && (
                      <Text style={styles.heroDescription} numberOfLines={2}>
                        {detail.profile.description}
                      </Text>
                    )}
                  </View>
                </View>

                {detail.profile.tags.length ? (
                  <View style={styles.tagRow}>
                    {detail.profile.tags.map((tag) => (
                      <View key={`${detail.profile.id}:${tag}`} style={styles.tagChip}>
                        <Text style={styles.tagChipText}>{tag}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}

                <View style={styles.metricRow}>
                  <View style={styles.metricCard}>
                    <Text style={styles.metricValue}>{detail.profile.bound_file_count}</Text>
                    <Text style={styles.metricLabel}>素材</Text>
                  </View>
                  <View style={styles.metricCard}>
                    <Text style={styles.metricValue}>{detail.profile.short_term_count}</Text>
                    <Text style={styles.metricLabel}>短期</Text>
                  </View>
                  <View style={styles.metricCard}>
                    <Text style={styles.metricValue}>{detail.profile.long_term_count}</Text>
                    <Text style={styles.metricLabel}>长期</Text>
                  </View>
                </View>
              </Animated.View>

              <Animated.View entering={FadeInUp.duration(180).delay(40)} style={styles.tabRow}>
                {TAB_OPTIONS.map((tab) => {
                  const active = tab.key === activeTab;
                  return (
                    <Pressable key={tab.key} onPress={() => setActiveTab(tab.key)} style={[styles.tabChip, active && styles.tabChipActive]}>
                      <Text style={[styles.tabChipText, active && styles.tabChipTextActive]}>{tab.label}</Text>
                    </Pressable>
                  );
                })}
              </Animated.View>

              <View style={[styles.stage, { minHeight: stageHeight }]}>
                {activeTab === "materials" ? (
                  materialAssets.length ? (
                    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.materialList}>
                      <View style={[styles.materialGrid, { gap: MATERIAL_GAP }]}>
                        {materialAssets.map((asset) => (
                          <UploadAssetTile key={asset.id} asset={asset} size={materialTileSize} onPress={() => setPreviewAsset(asset)} />
                        ))}
                      </View>
                    </ScrollView>
                  ) : (
                    <View style={styles.emptyStageCard}>
                      <Text style={styles.emptyStageText}>暂无素材</Text>
                    </View>
                  )
                ) : activeTab === "short_term" ? (
                  renderMemoryList(detail.short_term_memories, "short_term")
                ) : (
                  renderMemoryList(detail.long_term_memories, "long_term")
                )}
              </View>
            </>
          )}
        </ScrollView>
      </SafeAreaView>

      <Modal transparent visible={composerVisible} animationType="fade" onRequestClose={() => setComposerVisible(false)}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={() => setComposerVisible(false)} />
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.sheetHost}>
            <View style={styles.sheetCard}>
              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>新增记忆</Text>
                <Pressable style={({ pressed }) => [styles.sheetIconButton, pressed && styles.buttonPressed]} onPress={() => setComposerVisible(false)}>
                  <MaterialCommunityIcons name="close" size={18} color={palette.inkSoft} />
                </Pressable>
              </View>

              <View style={styles.scopeRow}>
                {(["short_term", "long_term"] as MemoryScope[]).map((item) => {
                  const active = scope === item;
                  return (
                    <Pressable key={item} onPress={() => setScope(item)} style={[styles.scopeChip, active && styles.scopeChipActive]}>
                      <Text style={[styles.scopeChipText, active && styles.scopeChipTextActive]}>{memoryScopeMeta[item].label}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <TextInput value={title} onChangeText={setTitle} placeholder="标题" placeholderTextColor={palette.lineStrong} style={styles.input} />
              <TextInput
                value={content}
                onChangeText={setContent}
                placeholder="内容"
                placeholderTextColor={palette.lineStrong}
                style={[styles.input, styles.inputMultiline]}
                multiline
              />

              <Pressable
                onPress={() => void handleCreateMemory()}
                disabled={creating}
                style={({ pressed }) => [styles.createButton, pressed && styles.buttonPressed, creating && styles.buttonDisabled]}
              >
                <Text style={styles.createButtonText}>{creating ? "保存中" : "加入"}</Text>
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      <AssetPreviewModal
        asset={previewAsset}
        onClose={() => setPreviewAsset(null)}
        onOpenRecord={(recordId) => {
          setPreviewAsset(null);
          router.push({ pathname: "/records/[id]", params: { id: recordId } } as never);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.background },
  safeArea: { flex: 1 },
  content: { paddingHorizontal: CONTENT_HORIZONTAL, paddingTop: 8, paddingBottom: 28, gap: 10 },
  backgroundOrbTop: {
    position: "absolute",
    top: -100,
    left: -40,
    width: 220,
    height: 220,
    borderRadius: 999,
    backgroundColor: "rgba(117, 167, 255, 0.14)",
  },
  backgroundOrbBottom: {
    position: "absolute",
    right: -88,
    bottom: 120,
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
  heroCard: {
    borderRadius: radius.xl,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 18,
    paddingVertical: 18,
    gap: 14,
    ...panelShadow,
  },
  heroTop: { flexDirection: "row", gap: 14 },
  avatarButton: { width: 72, height: 72 },
  avatar: { width: 72, height: 72, borderRadius: 22, backgroundColor: palette.backgroundDeep },
  avatarFallback: { width: 72, height: 72, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  avatarLoading: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 22,
    backgroundColor: "rgba(32,54,86,0.36)",
    alignItems: "center",
    justifyContent: "center",
  },
  heroCopy: { flex: 1, gap: 6 },
  heroName: { color: palette.ink, fontSize: 24, lineHeight: 30, fontWeight: "900", fontFamily: fontFamily.display },
  heroTypeBadge: { alignSelf: "flex-start", borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 6 },
  heroTypeText: { fontSize: 11, lineHeight: 14, fontWeight: "800", fontFamily: fontFamily.body },
  heroDescription: { color: palette.inkSoft, fontSize: 12, lineHeight: 18, fontFamily: fontFamily.body },
  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tagChip: { borderRadius: radius.pill, backgroundColor: palette.accentSoft, paddingHorizontal: 10, paddingVertical: 6 },
  tagChipText: { color: palette.accentStrong, fontSize: 11, lineHeight: 14, fontWeight: "700", fontFamily: fontFamily.body },
  metricRow: { flexDirection: "row", gap: 10 },
  metricCard: { flex: 1, borderRadius: radius.md, backgroundColor: palette.surfaceSoft, paddingHorizontal: 12, paddingVertical: 12, gap: 4 },
  metricValue: { color: palette.ink, fontSize: 18, lineHeight: 24, fontWeight: "900", fontFamily: fontFamily.display },
  metricLabel: { color: palette.inkSoft, fontSize: 11, lineHeight: 14, fontFamily: fontFamily.body },
  tabRow: { flexDirection: "row", gap: 8 },
  tabChip: {
    flex: 1,
    minHeight: 38,
    borderRadius: radius.pill,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    alignItems: "center",
    justifyContent: "center",
  },
  tabChipActive: { backgroundColor: palette.accentStrong, borderColor: palette.accentStrong },
  tabChipText: { color: palette.inkSoft, fontSize: 12, lineHeight: 16, fontWeight: "800", fontFamily: fontFamily.body },
  tabChipTextActive: { color: palette.inkInverse },
  stage: {
    borderRadius: 0,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 0,
    paddingVertical: 0,
    ...panelShadow,
  },
  materialList: { paddingBottom: 1 },
  materialGrid: { flexDirection: "row", flexWrap: "wrap" },
  memoryList: { gap: 10, paddingBottom: 4 },
  memoryCard: { borderRadius: radius.lg, backgroundColor: palette.surfaceSoft, paddingHorizontal: 14, paddingVertical: 14, gap: 10 },
  memoryTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  memoryCopy: { flex: 1, gap: 4 },
  memoryTitle: { color: palette.ink, fontSize: 14, lineHeight: 20, fontWeight: "800", fontFamily: fontFamily.body },
  memoryTime: { color: palette.inkSoft, fontSize: 11, lineHeight: 14, fontFamily: fontFamily.body },
  memoryContent: { color: palette.ink, fontSize: 13, lineHeight: 20, fontFamily: fontFamily.body },
  swapButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: palette.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyStageCard: {
    minHeight: 220,
    borderRadius: radius.lg,
    backgroundColor: palette.surfaceSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyStageText: { color: palette.inkSoft, fontSize: 13, lineHeight: 18, fontFamily: fontFamily.body },
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
  modalRoot: { flex: 1, justifyContent: "flex-end" },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(21, 42, 72, 0.32)" },
  sheetHost: { justifyContent: "flex-end" },
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
  sheetIconButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.surfaceSoft,
  },
  scopeRow: { flexDirection: "row", gap: 8 },
  scopeChip: {
    flex: 1,
    minHeight: 38,
    borderRadius: radius.pill,
    backgroundColor: palette.surfaceSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  scopeChipActive: { backgroundColor: palette.accentStrong },
  scopeChipText: { color: palette.accentStrong, fontSize: 12, lineHeight: 16, fontWeight: "800", fontFamily: fontFamily.body },
  scopeChipTextActive: { color: palette.inkInverse },
  input: {
    minHeight: 44,
    borderRadius: radius.md,
    backgroundColor: palette.surfaceSoft,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 14,
    color: palette.ink,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: fontFamily.body,
  },
  inputMultiline: { minHeight: 84, paddingTop: 12, paddingBottom: 12, textAlignVertical: "top" },
  createButton: {
    minHeight: 44,
    borderRadius: radius.pill,
    backgroundColor: palette.accentStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  createButtonText: { color: palette.inkInverse, fontSize: 14, lineHeight: 20, fontWeight: "800", fontFamily: fontFamily.body },
  buttonPressed: { opacity: 0.92 },
  buttonDisabled: { opacity: 0.6 },
});
