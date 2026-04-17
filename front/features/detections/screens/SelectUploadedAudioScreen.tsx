import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "@/features/auth";
import { flattenUserUploads, type GalleryAsset } from "@/features/uploads/asset-utils";
import { uploadsApi } from "@/features/uploads/api";
import { ApiError } from "@/shared/api";
import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";

import { setSelectedUploadedAudioDraft } from "../audio-selection-session";

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function SelectUploadedAudioScreen() {
  const router = useRouter();
  const { token } = useAuth();

  const [items, setItems] = useState<GalleryAsset[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!token) {
      setItems([]);
      setSelectedIds([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const uploads = await uploadsApi.list(token, 240);
      const audioAssets = flattenUserUploads(uploads).filter((item) => item.upload_type === "audio");
      setItems(audioAssets);
      setSelectedIds((prev) => prev.filter((id) => audioAssets.some((item) => item.id === id)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      void loadData();
    }, [loadData]),
  );

  const selectedItems = useMemo(
    () => items.filter((item) => selectedIds.includes(item.id)),
    [items, selectedIds],
  );

  const toggleSelect = useCallback((assetId: string) => {
    setSelectedIds((prev) => (prev.includes(assetId) ? prev.filter((item) => item !== assetId) : [...prev, assetId]));
  }, []);

  const handleOpenAudio = useCallback(async (asset: GalleryAsset) => {
    if (!asset.file_url) {
      return;
    }
    setOpeningId(asset.id);
    try {
      await WebBrowser.openBrowserAsync(asset.file_url);
    } catch (error) {
      Alert.alert("打开失败", error instanceof Error ? error.message : "暂时无法打开音频");
    } finally {
      setOpeningId((prev) => (prev === asset.id ? null : prev));
    }
  }, []);

  const handleConfirm = useCallback(() => {
    if (!selectedItems.length) {
      return;
    }
    setSubmitting(true);
    setSelectedUploadedAudioDraft(
      selectedItems.map((item) => ({
        id: item.id,
        upload_id: item.upload_id,
        file_path: item.file_path,
        file_name: item.file_name,
        file_url: item.file_url,
        created_at: item.created_at,
        subtitle: item.subtitle,
      })),
    );
    router.back();
  }, [router, selectedItems]);

  const renderItem = useCallback(
    ({ item }: { item: GalleryAsset }) => {
      const selected = selectedIds.includes(item.id);
      const opening = openingId === item.id;

      return (
        <Pressable
          style={({ pressed }) => [
            styles.itemCard,
            selected && styles.itemCardSelected,
            pressed && styles.buttonPressed,
          ]}
          onPress={() => toggleSelect(item.id)}
        >
          <View style={styles.itemIconWrap}>
            <MaterialCommunityIcons name="waveform" size={20} color={palette.accentStrong} />
          </View>

          <View style={styles.itemCopy}>
            <Text style={styles.itemTitle} numberOfLines={1}>
              {item.file_name}
            </Text>
            <View style={styles.itemMetaRow}>
              <Text style={styles.itemMeta}>{item.subtitle}</Text>
              <Text style={styles.itemMeta}>{formatDateTime(item.created_at)}</Text>
            </View>
          </View>

          <View style={styles.itemActions}>
            {item.file_url ? (
              <Pressable
                style={({ pressed }) => [styles.previewButton, pressed && styles.buttonPressed]}
                onPress={() => void handleOpenAudio(item)}
              >
                {opening ? (
                  <ActivityIndicator size="small" color={palette.accentStrong} />
                ) : (
                  <MaterialCommunityIcons name="play-circle-outline" size={18} color={palette.accentStrong} />
                )}
              </Pressable>
            ) : null}

            <View style={[styles.checkbox, selected && styles.checkboxSelected]}>
              {selected ? <MaterialCommunityIcons name="check" size={15} color={palette.inkInverse} /> : null}
            </View>
          </View>
        </Pressable>
      );
    },
    [handleOpenAudio, openingId, selectedIds, toggleSelect],
  );

  return (
    <View style={styles.root}>
      <View style={styles.backgroundOrbTop} />
      <View style={styles.backgroundOrbBottom} />

      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <View style={styles.header}>
          <View style={styles.headerTopRow}>
            <Pressable style={({ pressed }) => [styles.backButton, pressed && styles.buttonPressed]} onPress={() => router.back()}>
              <MaterialCommunityIcons name="chevron-left" size={20} color={palette.accentStrong} />
            </Pressable>
            <View style={styles.headerCopy}>
              <Text style={styles.pageTitle}>已上传音频</Text>
              <Text style={styles.pageSubtitle}>选择后加入检测</Text>
            </View>
          </View>

          <View style={styles.summaryCard}>
            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>可选</Text>
              <Text style={styles.metricValue}>{items.length}</Text>
            </View>
            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>已选</Text>
              <Text style={styles.metricValue}>{selectedIds.length}</Text>
            </View>
          </View>
        </View>

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
        ) : items.length === 0 ? (
          <View style={styles.stateCard}>
            <Text style={styles.stateTitle}>暂无已上传音频</Text>
            <Text style={styles.stateText}>先去上传，再回来选择</Text>
          </View>
        ) : (
          <FlatList
            data={items}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            contentContainerStyle={styles.listContent}
            ItemSeparatorComponent={() => <View style={styles.itemGap} />}
            showsVerticalScrollIndicator={false}
            initialNumToRender={10}
            maxToRenderPerBatch={10}
            windowSize={7}
            removeClippedSubviews
          />
        )}
      </SafeAreaView>

      <View style={styles.bottomBar}>
        <View style={styles.bottomInfo}>
          <Text style={styles.bottomCount}>{selectedIds.length}</Text>
          <Text style={styles.bottomLabel}>个音频</Text>
        </View>

        <Pressable
          style={({ pressed }) => [
            styles.confirmButton,
            selectedIds.length === 0 && styles.confirmButtonDisabled,
            pressed && selectedIds.length > 0 && styles.buttonPressed,
          ]}
          disabled={selectedIds.length === 0 || submitting}
          onPress={handleConfirm}
        >
          <Text style={styles.confirmButtonText}>加入检测</Text>
        </Pressable>
      </View>
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
  backgroundOrbTop: {
    position: "absolute",
    top: -96,
    left: -38,
    width: 220,
    height: 220,
    borderRadius: 999,
    backgroundColor: "rgba(117, 167, 255, 0.14)",
  },
  backgroundOrbBottom: {
    position: "absolute",
    right: -86,
    bottom: 130,
    width: 230,
    height: 230,
    borderRadius: 999,
    backgroundColor: "rgba(196, 218, 255, 0.18)",
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 14,
  },
  headerTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  backButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    alignItems: "center",
    justifyContent: "center",
  },
  headerCopy: {
    flex: 1,
    gap: 3,
  },
  pageTitle: {
    color: palette.ink,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  pageSubtitle: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fontFamily.body,
  },
  summaryCard: {
    flexDirection: "row",
    gap: 10,
  },
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
  metricLabel: {
    color: palette.inkSoft,
    fontSize: 11,
    lineHeight: 14,
    fontFamily: fontFamily.body,
  },
  metricValue: {
    color: palette.ink,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 116,
  },
  itemGap: {
    height: 10,
  },
  itemCard: {
    borderRadius: radius.lg,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 14,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    ...panelShadow,
  },
  itemCardSelected: {
    borderColor: palette.accentStrong,
    backgroundColor: palette.surfaceSoft,
  },
  itemIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: palette.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  itemCopy: {
    flex: 1,
    gap: 6,
  },
  itemTitle: {
    color: palette.ink,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  itemMetaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  itemMeta: {
    color: palette.inkSoft,
    fontSize: 11,
    lineHeight: 14,
    fontFamily: fontFamily.body,
  },
  itemActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  previewButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: palette.surfaceSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: palette.lineStrong,
    backgroundColor: palette.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxSelected: {
    borderColor: palette.accentStrong,
    backgroundColor: palette.accentStrong,
  },
  stateCard: {
    marginHorizontal: 16,
    marginTop: 20,
    borderRadius: radius.xl,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 18,
    paddingVertical: 24,
    alignItems: "center",
    gap: 8,
    ...panelShadow,
  },
  stateTitle: {
    color: palette.ink,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  stateText: {
    color: palette.inkSoft,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fontFamily.body,
  },
  bottomBar: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 12,
    borderRadius: radius.xl,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    ...panelShadow,
  },
  bottomInfo: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 4,
  },
  bottomCount: {
    color: palette.ink,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "900",
    fontFamily: fontFamily.display,
  },
  bottomLabel: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fontFamily.body,
  },
  confirmButton: {
    minWidth: 112,
    minHeight: 44,
    borderRadius: radius.pill,
    backgroundColor: palette.accentStrong,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  confirmButtonDisabled: {
    opacity: 0.48,
  },
  confirmButtonText: {
    color: palette.inkInverse,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  buttonPressed: {
    transform: [{ scale: 0.98 }],
  },
});
