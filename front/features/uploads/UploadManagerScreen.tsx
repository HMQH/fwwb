import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import Animated, { FadeInUp } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "@/features/auth";
import { relationsApi } from "@/features/relations/api";
import type { RelationProfileSummary } from "@/features/relations/types";
import { ApiError } from "@/shared/api";
import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";

import { setUploadArchiveDraft } from "./archive-session";
import { flattenUserUploads, groupAssetsByDay, type GalleryAsset } from "./asset-utils";
import { uploadsApi } from "./api";
import AssetPreviewModal from "./components/AssetPreviewModal";
import UploadAssetTile from "./components/UploadAssetTile";
import type { UserUpload } from "./types";

type FilterMode = "all" | "assigned" | "unassigned";

const ZOOM_LABELS = ["紧凑", "标准", "放大"] as const;
const DESIRED_TILE_WIDTH = [72, 92, 112];
const GRID_GAP = 1;
const GALLERY_HORIZONTAL = 8;

const FILTER_META: Record<FilterMode, { label: string; getValue: (summary: Summary) => number }> = {
  all: { label: "全部", getValue: (summary) => summary.total },
  assigned: { label: "已归档", getValue: (summary) => summary.assigned },
  unassigned: { label: "待归档", getValue: (summary) => summary.pending },
};

type Summary = {
  total: number;
  pending: number;
  assigned: number;
};

export default function UploadManagerScreen() {
  const router = useRouter();
  const { token } = useAuth();
  const { width } = useWindowDimensions();

  const [uploads, setUploads] = useState<UserUpload[]>([]);
  const [relations, setRelations] = useState<RelationProfileSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoomIndex, setZoomIndex] = useState(1);
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [previewAsset, setPreviewAsset] = useState<GalleryAsset | null>(null);

  const loadData = useCallback(async () => {
    if (!token) {
      setUploads([]);
      setRelations([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [uploadRes, relationRes] = await Promise.all([uploadsApi.list(token, 180), relationsApi.list(token)]);
      setUploads(uploadRes);
      setRelations(relationRes);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      void loadData();
    }, [loadData])
  );

  const summary = useMemo<Summary>(() => {
    return uploads.reduce(
      (acc, item) => {
        acc.total += item.file_count;
        acc.pending += item.unassigned_file_count;
        acc.assigned += item.assigned_file_count;
        return acc;
      },
      { total: 0, pending: 0, assigned: 0 }
    );
  }, [uploads]);

  const assets = useMemo(() => flattenUserUploads(uploads), [uploads]);
  const filteredAssets = useMemo(() => {
    if (filterMode === "assigned") {
      return assets.filter((item) => item.assigned);
    }
    if (filterMode === "unassigned") {
      return assets.filter((item) => !item.assigned);
    }
    return assets;
  }, [assets, filterMode]);
  const sections = useMemo(() => groupAssetsByDay(filteredAssets), [filteredAssets]);
  const assetMap = useMemo(() => new Map(assets.map((item) => [item.id, item])), [assets]);

  const selectedAssets = useMemo(
    () => selectedIds.map((id) => assetMap.get(id)).filter((item): item is GalleryAsset => Boolean(item)),
    [assetMap, selectedIds]
  );

  const desiredTileWidth = DESIRED_TILE_WIDTH[zoomIndex];
  const galleryWidth = width - GALLERY_HORIZONTAL * 2;
  const columns = Math.max(3, Math.min(5, Math.floor((galleryWidth + GRID_GAP) / (desiredTileWidth + GRID_GAP))));
  const tileSize = Math.max(72, Math.floor((galleryWidth - GRID_GAP * (columns - 1)) / columns));

  const resetSelection = useCallback(() => {
    setSelectionMode(false);
    setSelectedIds([]);
  }, []);

  const toggleSelection = useCallback((assetId: string) => {
    setSelectedIds((prev) =>
      prev.includes(assetId) ? prev.filter((item) => item !== assetId) : [...prev, assetId]
    );
  }, []);

  const handleAssetPress = useCallback(
    (asset: GalleryAsset) => {
      if (selectionMode) {
        toggleSelection(asset.id);
        return;
      }

      setPreviewAsset(asset);
    },
    [selectionMode, toggleSelection]
  );

  const handleAssetLongPress = useCallback(
    async (asset: GalleryAsset) => {
      if (!relations.length) {
        Alert.alert("先建关系", "先去关系记忆里新建联系人");
        return;
      }

      await Haptics.selectionAsync().catch(() => undefined);
      setPreviewAsset(null);
      setSelectionMode(true);
      setSelectedIds((prev) => (prev.includes(asset.id) ? prev : [...prev, asset.id]));
    },
    [relations.length]
  );

  const handleNextStep = useCallback(() => {
    if (!selectedAssets.length) {
      return;
    }
    setUploadArchiveDraft(selectedAssets);
    router.push("/uploads/archive");
  }, [router, selectedAssets]);

  return (
    <View style={styles.root}>
      <View style={styles.backgroundOrbTop} />
      <View style={styles.backgroundOrbBottom} />

      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <Animated.View entering={FadeInUp.duration(180)} style={styles.headerWrap}>
          <View style={styles.topBar}>
            <Pressable style={({ pressed }) => [styles.iconButton, pressed && styles.buttonPressed]} onPress={() => router.push("/profile")}>
              <MaterialCommunityIcons name="chevron-left" size={20} color={palette.accentStrong} />
            </Pressable>

            <View style={styles.titleBlock}>
              <Text style={styles.pageTitle}>上传管理</Text>
              <Text style={styles.pageSubtitle}>按时间归档</Text>
            </View>

            <View style={styles.zoomControls}>
              {ZOOM_LABELS.map((label, index) => {
                const active = zoomIndex === index;
                return (
                  <Pressable
                    key={label}
                    onPress={() => setZoomIndex(index)}
                    style={({ pressed }) => [
                      styles.zoomChip,
                      active && styles.zoomChipActive,
                      pressed && styles.buttonPressed,
                    ]}
                  >
                    <Text style={[styles.zoomChipText, active && styles.zoomChipTextActive]}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.metricRow}>
            {(Object.keys(FILTER_META) as FilterMode[]).map((item) => {
              const active = filterMode === item;
              const meta = FILTER_META[item];
              return (
                <Pressable
                  key={item}
                  onPress={() => setFilterMode(item)}
                  style={({ pressed }) => [
                    styles.metricCard,
                    active && styles.metricCardActive,
                    pressed && styles.buttonPressed,
                  ]}
                >
                  <Text style={[styles.metricValue, active && styles.metricValueActive]}>{meta.getValue(summary)}</Text>
                  <Text style={[styles.metricLabel, active && styles.metricLabelActive]}>{meta.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </Animated.View>

        <ScrollView
          style={styles.galleryScroller}
          contentContainerStyle={[styles.galleryContent, selectionMode && styles.galleryContentSelection]}
          showsVerticalScrollIndicator={false}
        >
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
          ) : !filteredAssets.length ? (
            <View style={styles.stateCard}>
              <Text style={styles.stateTitle}>暂无素材</Text>
            </View>
          ) : (
            sections.map((section, sectionIndex) => (
              <Animated.View key={section.key} entering={FadeInUp.duration(160).delay(sectionIndex * 20)} style={styles.sectionWrap}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>{section.label}</Text>
                  <Text style={styles.sectionCount}>{section.items.length}</Text>
                </View>

                <View style={[styles.grid, { gap: GRID_GAP }]}>
                  {section.items.map((asset) => (
                    <UploadAssetTile
                      key={asset.id}
                      asset={asset}
                      size={tileSize}
                      selected={selectedIds.includes(asset.id)}
                      selectionMode={selectionMode}
                      onPress={() => handleAssetPress(asset)}
                      onLongPress={() => void handleAssetLongPress(asset)}
                    />
                  ))}
                </View>
              </Animated.View>
            ))
          )}
        </ScrollView>

        {selectionMode ? (
          <Animated.View entering={FadeInUp.duration(160)} style={styles.multiBar}>
            <View style={styles.multiInfo}>
              <MaterialCommunityIcons name="checkbox-multiple-marked-outline" size={18} color={palette.accentStrong} />
              <Text style={styles.multiText}>{`${selectedIds.length} 项`}</Text>
            </View>

            <View style={styles.multiActions}>
              <Pressable style={({ pressed }) => [styles.multiGhostButton, pressed && styles.buttonPressed]} onPress={resetSelection}>
                <Text style={styles.multiGhostText}>取消</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.multiPrimaryButton,
                  selectedIds.length === 0 && styles.multiPrimaryButtonDisabled,
                  pressed && selectedIds.length > 0 && styles.buttonPressed,
                ]}
                disabled={selectedIds.length === 0}
                onPress={handleNextStep}
              >
                <Text style={styles.multiPrimaryText}>下一步</Text>
              </Pressable>
            </View>
          </Animated.View>
        ) : null}
      </SafeAreaView>

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
  backgroundOrbTop: {
    position: "absolute",
    top: -110,
    left: -40,
    width: 240,
    height: 240,
    borderRadius: 999,
    backgroundColor: "rgba(117, 167, 255, 0.14)",
  },
  backgroundOrbBottom: {
    position: "absolute",
    right: -90,
    bottom: 40,
    width: 240,
    height: 240,
    borderRadius: 999,
    backgroundColor: "rgba(196, 218, 255, 0.18)",
  },
  headerWrap: { paddingHorizontal: 16, paddingTop: 8, gap: 12 },
  topBar: { flexDirection: "row", alignItems: "center", gap: 10 },
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
  zoomControls: { flexDirection: "row", gap: 6 },
  zoomChip: {
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
  },
  zoomChipActive: { backgroundColor: palette.accentStrong, borderColor: palette.accentStrong },
  zoomChipText: { color: palette.inkSoft, fontSize: 11, lineHeight: 14, fontWeight: "800", fontFamily: fontFamily.body },
  zoomChipTextActive: { color: palette.inkInverse },
  metricRow: { flexDirection: "row", gap: 8 },
  metricCard: {
    flex: 1,
    borderRadius: radius.xl,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 4,
    ...panelShadow,
  },
  metricCardActive: { backgroundColor: palette.accentStrong, borderColor: palette.accentStrong },
  metricValue: { color: palette.ink, fontSize: 21, lineHeight: 26, fontWeight: "900", fontFamily: fontFamily.display },
  metricValueActive: { color: palette.inkInverse },
  metricLabel: { color: palette.inkSoft, fontSize: 11, lineHeight: 14, fontFamily: fontFamily.body },
  metricLabelActive: { color: "rgba(255,255,255,0.86)" },
  galleryScroller: { flex: 1 },
  galleryContent: { paddingHorizontal: GALLERY_HORIZONTAL, paddingTop: 12, paddingBottom: 28, gap: 12 },
  galleryContentSelection: { paddingBottom: 104 },
  sectionWrap: { gap: 8 },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitle: { color: palette.ink, fontSize: 15, lineHeight: 20, fontWeight: "800", fontFamily: fontFamily.display },
  sectionCount: { color: palette.inkSoft, fontSize: 11, lineHeight: 14, fontFamily: fontFamily.body },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  stateCard: {
    borderRadius: radius.lg,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 18,
    paddingVertical: 24,
    gap: 8,
    alignItems: "center",
    ...panelShadow,
  },
  stateTitle: { color: palette.ink, fontSize: 16, lineHeight: 22, fontWeight: "900", fontFamily: fontFamily.display },
  stateText: { color: palette.inkSoft, fontSize: 13, lineHeight: 18, fontFamily: fontFamily.body },
  multiBar: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: radius.pill,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    ...panelShadow,
  },
  multiInfo: { flexDirection: "row", alignItems: "center", gap: 8 },
  multiText: { color: palette.ink, fontSize: 13, lineHeight: 18, fontWeight: "800", fontFamily: fontFamily.body },
  multiActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  multiGhostButton: {
    minHeight: 34,
    borderRadius: radius.pill,
    backgroundColor: palette.surfaceSoft,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  multiGhostText: { color: palette.inkSoft, fontSize: 12, lineHeight: 16, fontWeight: "800", fontFamily: fontFamily.body },
  multiPrimaryButton: {
    minHeight: 34,
    borderRadius: radius.pill,
    backgroundColor: palette.accentStrong,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  multiPrimaryButtonDisabled: { opacity: 0.45 },
  multiPrimaryText: { color: palette.inkInverse, fontSize: 12, lineHeight: 16, fontWeight: "800", fontFamily: fontFamily.body },
  buttonPressed: { opacity: 0.9 },
});
