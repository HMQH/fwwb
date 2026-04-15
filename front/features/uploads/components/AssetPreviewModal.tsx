import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated, { FadeInUp } from "react-native-reanimated";

import { formatAssetTime, type GalleryAsset } from "@/features/uploads/asset-utils";
import { fontFamily, palette, radius } from "@/shared/theme";

type Props = {
  asset: GalleryAsset | null;
  onClose: () => void;
  onOpenRecord?: (recordId: string) => void;
};

const PREVIEW_ICON_MAP: Record<string, keyof typeof MaterialCommunityIcons.glyphMap> = {
  text: "file-document-outline",
  audio: "waveform",
  image: "image-outline",
  video: "video-outline",
};

type ExpoVideoModule = typeof import("expo-video");

let expoVideoModule: ExpoVideoModule | null = null;
try {
  expoVideoModule = require("expo-video") as ExpoVideoModule;
} catch {
  expoVideoModule = null;
}

function getPreviewTitle(asset: GalleryAsset) {
  return asset.title || asset.file_name;
}

function NativeVideoPreview({ uri }: { uri: string }) {
  if (!expoVideoModule) {
    return null;
  }

  const { VideoView, useVideoPlayer } = expoVideoModule;
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = false;
    instance.play();
  });

  return <VideoView player={player} style={styles.previewVideo} nativeControls contentFit="contain" />;
}

export default function AssetPreviewModal({ asset, onClose, onOpenRecord }: Props) {
  const [textLoading, setTextLoading] = useState(false);
  const [textContent, setTextContent] = useState("");

  useEffect(() => {
    let active = true;

    if (!asset || asset.upload_type !== "text" || !asset.file_url) {
      setTextLoading(false);
      setTextContent("");
      return () => {
        active = false;
      };
    }

    setTextLoading(true);
    setTextContent("");

    fetch(asset.file_url)
      .then((response) => response.text())
      .then((text) => {
        if (active) {
          setTextContent(text.replace(/^\uFEFF/, ""));
        }
      })
      .catch(() => {
        if (active) {
          setTextContent("读取失败");
        }
      })
      .finally(() => {
        if (active) {
          setTextLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [asset]);

  const videoAvailable = useMemo(() => Boolean(expoVideoModule), []);

  return (
    <Modal transparent visible={Boolean(asset)} animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <Pressable style={styles.modalBackdrop} onPress={onClose} />

        {asset ? (
          <Animated.View entering={FadeInUp.duration(180)} style={styles.previewCard}>
            <View style={styles.previewHeader}>
              <View style={styles.previewHeaderCopy}>
                <Text style={styles.previewTitle} numberOfLines={1}>
                  {getPreviewTitle(asset)}
                </Text>
                <Text style={styles.previewMeta}>{formatAssetTime(asset.created_at)}</Text>
              </View>

              <Pressable style={({ pressed }) => [styles.previewClose, pressed && styles.buttonPressed]} onPress={onClose}>
                <MaterialCommunityIcons name="close" size={18} color={palette.inkSoft} />
              </Pressable>
            </View>

            {asset.upload_type === "image" && asset.file_url ? (
              <Image source={{ uri: asset.file_url }} style={styles.previewImage} contentFit="contain" />
            ) : asset.upload_type === "video" && asset.file_url && videoAvailable ? (
              <NativeVideoPreview uri={asset.file_url} />
            ) : asset.upload_type === "text" ? (
              <View style={styles.textWrap}>
                {textLoading ? (
                  <View style={styles.textLoading}>
                    <ActivityIndicator size="small" color={palette.accentStrong} />
                  </View>
                ) : (
                  <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.textScroller}>
                    <Text style={styles.textContent}>{textContent || "暂无内容"}</Text>
                  </ScrollView>
                )}
              </View>
            ) : (
              <View style={styles.previewFallback}>
                <MaterialCommunityIcons
                  name={PREVIEW_ICON_MAP[asset.upload_type] ?? "file-outline"}
                  size={34}
                  color={palette.accentStrong}
                />
                {asset.upload_type === "video" && !videoAvailable ? (
                  <Text style={styles.fallbackText}>当前版本未启用视频播放</Text>
                ) : null}
              </View>
            )}

            {asset.source_submission_id && onOpenRecord ? (
              <Pressable
                style={({ pressed }) => [styles.openRecordButton, pressed && styles.buttonPressed]}
                onPress={() => onOpenRecord(asset.source_submission_id!)}
              >
                <MaterialCommunityIcons name="history" size={16} color={palette.accentStrong} />
                <Text style={styles.openRecordText}>检测记录</Text>
              </Pressable>
            ) : null}
          </Animated.View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: { flex: 1, justifyContent: "flex-end" },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(21, 42, 72, 0.32)" },
  previewCard: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    backgroundColor: palette.surface,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 28,
    gap: 12,
  },
  previewHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  previewHeaderCopy: { flex: 1, gap: 2 },
  previewTitle: { color: palette.ink, fontSize: 18, lineHeight: 24, fontWeight: "900", fontFamily: fontFamily.display },
  previewMeta: { color: palette.inkSoft, fontSize: 12, lineHeight: 16, fontFamily: fontFamily.body },
  previewClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: palette.surfaceSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  previewImage: {
    width: "100%",
    height: 300,
    borderRadius: radius.lg,
    backgroundColor: palette.backgroundDeep,
  },
  previewVideo: {
    width: "100%",
    height: 300,
    borderRadius: radius.lg,
    backgroundColor: palette.backgroundDeep,
  },
  textWrap: {
    height: 300,
    borderRadius: radius.lg,
    backgroundColor: palette.surfaceSoft,
    overflow: "hidden",
  },
  textLoading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  textScroller: {
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  textContent: {
    color: palette.ink,
    fontSize: 14,
    lineHeight: 24,
    fontFamily: fontFamily.body,
  },
  previewFallback: {
    height: 220,
    borderRadius: radius.lg,
    backgroundColor: palette.surfaceSoft,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  fallbackText: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fontFamily.body,
  },
  openRecordButton: {
    alignSelf: "flex-start",
    minHeight: 40,
    borderRadius: radius.pill,
    backgroundColor: palette.accentSoft,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  openRecordText: {
    color: palette.accentStrong,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    fontFamily: fontFamily.body,
  },
  buttonPressed: { opacity: 0.92 },
});
