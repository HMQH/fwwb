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
import { relationTypeMeta, type RelationProfileSummary } from "@/features/relations/types";
import { ApiError, resolveApiFileUrl } from "@/shared/api";
import { fontFamily, palette, panelShadow, radius } from "@/shared/theme";
import { ManagedImage as Image } from "@/shared/ui/ManagedImage";

import { clearUploadArchiveDraft, getUploadArchiveDraft } from "./archive-session";
import type { GalleryAsset } from "./asset-utils";
import { uploadsApi } from "./api";
import UploadAssetTile from "./components/UploadAssetTile";

const GRID_GAP = 1;
const CONTENT_HORIZONTAL = 12;

export default function UploadArchiveScreen() {
  const router = useRouter();
  const { token } = useAuth();
  const { width } = useWindowDimensions();

  const [relations, setRelations] = useState<RelationProfileSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeRelationId, setActiveRelationId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const draft = getUploadArchiveDraft();
  const assets = draft?.assets ?? [];
  const stageWidth = width - CONTENT_HORIZONTAL * 2 - 2;
  const columns = Math.max(3, Math.min(5, Math.floor((stageWidth + GRID_GAP) / (84 + GRID_GAP))));
  const tileSize = Math.max(84, Math.floor((stageWidth - GRID_GAP * (columns - 1)) / columns));

  const groupedUploads = useMemo(() => {
    const grouped = new Map<string, string[]>();
    assets.forEach((asset) => {
      grouped.set(asset.upload_id, [...(grouped.get(asset.upload_id) ?? []), asset.file_path]);
    });
    return grouped;
  }, [assets]);

  const loadRelations = useCallback(async () => {
    if (!token) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await relationsApi.list(token);
      setRelations(response);
      setActiveRelationId((prev) => prev ?? response[0]?.id ?? null);
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

  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  const handleArchive = useCallback(async () => {
    if (!token || !activeRelationId || assets.length === 0) {
      return;
    }

    setSaving(true);
    try {
      await Promise.all(
        Array.from(groupedUploads.entries()).map(([uploadId, filePaths]) =>
          uploadsApi.assign(
            uploadId,
            {
              relation_profile_id: activeRelationId,
              file_paths: Array.from(new Set(filePaths)),
              memory_scope: "short_term",
            },
            token
          )
        )
      );

      clearUploadArchiveDraft();
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      router.replace("/uploads");
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "归档失败";
      Alert.alert("归档失败", message);
    } finally {
      setSaving(false);
    }
  }, [activeRelationId, assets.length, groupedUploads, router, token]);

  if (!assets.length) {
    return (
      <View style={styles.root}>
        <SafeAreaView style={styles.safeArea} edges={["top"]}>
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyTitle}>没有待归档素材</Text>
            <Pressable style={({ pressed }) => [styles.backHomeButton, pressed && styles.buttonPressed]} onPress={() => router.replace("/uploads")}>
              <Text style={styles.backHomeText}>返回上传管理</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.backgroundOrbTop} />
      <View style={styles.backgroundOrbBottom} />
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <Animated.View entering={FadeInUp.duration(180)} style={styles.headerWrap}>
          <View style={styles.topBar}>
            <Pressable style={({ pressed }) => [styles.iconButton, pressed && styles.buttonPressed]} onPress={handleBack}>
              <MaterialCommunityIcons name="chevron-left" size={20} color={palette.accentStrong} />
            </Pressable>
            <View style={styles.titleBlock}>
              <Text style={styles.pageTitle}>归档</Text>
              <Text style={styles.pageSubtitle}>{`${assets.length} 项`}</Text>
            </View>
          </View>
        </Animated.View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.selectionStage}>
            <View style={[styles.grid, { gap: GRID_GAP }]}>
              {assets.map((asset) => (
                <UploadAssetTile key={asset.id} asset={asset} size={tileSize} />
              ))}
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
          ) : (
            <View style={styles.relationList}>
              {relations.map((relation) => {
                const meta = relationTypeMeta[relation.relation_type];
                const active = relation.id === activeRelationId;
                const avatarUri = resolveApiFileUrl(relation.avatar_url);

                return (
                  <Pressable
                    key={relation.id}
                    onPress={() => setActiveRelationId(relation.id)}
                    style={({ pressed }) => [
                      styles.relationRow,
                      active && { borderColor: meta.accent, backgroundColor: meta.soft },
                      pressed && styles.buttonPressed,
                    ]}
                  >
                    {avatarUri ? (
                      <Image source={{ uri: avatarUri }} style={styles.relationAvatar} contentFit="cover" imagePreset="avatar" />
                    ) : (
                      <View style={[styles.relationAvatarFallback, { backgroundColor: meta.soft }]}>
                        <MaterialCommunityIcons
                          name={meta.icon as keyof typeof MaterialCommunityIcons.glyphMap}
                          size={18}
                          color={meta.accent}
                        />
                      </View>
                    )}

                    <View style={styles.relationCopy}>
                      <Text style={styles.relationName}>{relation.name}</Text>
                      <Text style={[styles.relationType, active && { color: meta.accent }]}>{meta.label}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}
        </ScrollView>

        <View style={styles.footerBar}>
          <Pressable
            onPress={() => {
              clearUploadArchiveDraft();
              router.replace("/uploads");
            }}
            style={({ pressed }) => [styles.footerGhostButton, pressed && styles.buttonPressed]}
          >
            <Text style={styles.footerGhostText}>取消</Text>
          </Pressable>

          <Pressable
            onPress={() => void handleArchive()}
            disabled={!activeRelationId || saving}
            style={({ pressed }) => [
              styles.footerPrimaryButton,
              (!activeRelationId || saving) && styles.footerPrimaryButtonDisabled,
              pressed && activeRelationId && !saving && styles.buttonPressed,
            ]}
          >
            <Text style={styles.footerPrimaryText}>{saving ? "归档中" : "确认归档"}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
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
    right: -80,
    bottom: 40,
    width: 220,
    height: 220,
    borderRadius: 999,
    backgroundColor: "rgba(196, 218, 255, 0.18)",
  },
  headerWrap: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
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
  content: { paddingHorizontal: CONTENT_HORIZONTAL, paddingTop: 12, paddingBottom: 120, gap: 12 },
  selectionStage: {
    borderRadius: 0,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 0,
    paddingVertical: 0,
    ...panelShadow,
  },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  relationList: { gap: 10 },
  relationRow: {
    minHeight: 62,
    borderRadius: radius.lg,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    ...panelShadow,
  },
  relationAvatar: {
    width: 42,
    height: 42,
    borderRadius: 16,
  },
  relationAvatarFallback: {
    width: 42,
    height: 42,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  relationCopy: { flex: 1, gap: 2 },
  relationName: { color: palette.ink, fontSize: 15, lineHeight: 20, fontWeight: "800", fontFamily: fontFamily.display },
  relationType: { color: palette.inkSoft, fontSize: 12, lineHeight: 16, fontFamily: fontFamily.body },
  footerBar: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 12,
    flexDirection: "row",
    gap: 10,
  },
  footerGhostButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.surface,
    alignItems: "center",
    justifyContent: "center",
    ...panelShadow,
  },
  footerGhostText: { color: palette.ink, fontSize: 14, lineHeight: 18, fontWeight: "800", fontFamily: fontFamily.body },
  footerPrimaryButton: {
    flex: 1.4,
    minHeight: 48,
    borderRadius: radius.pill,
    backgroundColor: palette.accentStrong,
    alignItems: "center",
    justifyContent: "center",
    ...panelShadow,
  },
  footerPrimaryButtonDisabled: { opacity: 0.45 },
  footerPrimaryText: { color: palette.inkInverse, fontSize: 14, lineHeight: 18, fontWeight: "800", fontFamily: fontFamily.body },
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
  emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14, paddingHorizontal: 24 },
  emptyTitle: { color: palette.ink, fontSize: 18, lineHeight: 24, fontWeight: "900", fontFamily: fontFamily.display },
  backHomeButton: {
    minHeight: 44,
    borderRadius: radius.pill,
    backgroundColor: palette.accentStrong,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  backHomeText: { color: palette.inkInverse, fontSize: 14, lineHeight: 18, fontWeight: "800", fontFamily: fontFamily.body },
  buttonPressed: { opacity: 0.92 },
});
