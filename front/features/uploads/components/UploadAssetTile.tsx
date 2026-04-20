import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import type { GalleryAsset } from "@/features/uploads/asset-utils";
import { palette } from "@/shared/theme";
import { ManagedImage as Image } from "@/shared/ui/ManagedImage";

type ExpoVideoThumbnailsModule = typeof import("expo-video-thumbnails");

let expoVideoThumbnailsModule: ExpoVideoThumbnailsModule | null = null;
try {
  expoVideoThumbnailsModule = require("expo-video-thumbnails") as ExpoVideoThumbnailsModule;
} catch {
  expoVideoThumbnailsModule = null;
}

const ICON_MAP: Record<string, keyof typeof MaterialCommunityIcons.glyphMap> = {
  text: "file-document-outline",
  audio: "waveform",
  image: "image-outline",
  video: "video-outline",
};

const COLOR_MAP: Record<string, string> = {
  text: "#4B8DF8",
  audio: "#2794F1",
  image: "#5F70FF",
  video: "#8B61FF",
};

type Props = {
  asset: GalleryAsset;
  size: number;
  selected?: boolean;
  selectionMode?: boolean;
  focused?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
};

export default function UploadAssetTile({
  asset,
  size,
  selected = false,
  selectionMode = false,
  focused = false,
  onPress,
  onLongPress,
}: Props) {
  const accent = COLOR_MAP[asset.upload_type] ?? palette.accentStrong;
  const icon = ICON_MAP[asset.upload_type] ?? "file-outline";
  const [videoThumbnail, setVideoThumbnail] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    if (asset.upload_type !== "video" || !asset.file_url) {
      setVideoThumbnail(null);
      return () => {
        active = false;
      };
    }

    if (!expoVideoThumbnailsModule) {
      setVideoThumbnail(null);
      return () => {
        active = false;
      };
    }

    expoVideoThumbnailsModule
      .getThumbnailAsync(asset.file_url, { time: 0 })
      .then((result) => {
        if (active) {
          setVideoThumbnail(result.uri);
        }
      })
      .catch(() => {
        if (active) {
          setVideoThumbnail(null);
        }
      });

    return () => {
      active = false;
    };
  }, [asset.file_url, asset.upload_type]);

  const visualUri = asset.preview_url ?? videoThumbnail;

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={220}
      style={({ pressed }) => [
        styles.shell,
        {
          width: size,
          height: size,
          borderColor: selected || focused ? accent : "transparent",
          opacity: pressed ? 0.92 : 1,
        },
        (selected || focused) && styles.shellActive,
      ]}
    >
      {visualUri ? (
        <Image source={{ uri: visualUri }} style={styles.previewImage} contentFit="cover" imagePreset="tile" />
      ) : (
        <View style={[styles.previewFallback, { backgroundColor: `${accent}14` }]}>
          <View style={[styles.fallbackOrb, { backgroundColor: `${accent}18` }]} />
          <MaterialCommunityIcons name={icon} size={Math.max(24, Math.floor(size * 0.28))} color={accent} />
        </View>
      )}

      {asset.upload_type === "video" ? (
        <View style={styles.playBadge} pointerEvents="none">
          <MaterialCommunityIcons name="play" size={18} color={palette.inkInverse} />
        </View>
      ) : null}

      <View style={styles.topOverlay}>
        {selectionMode ? (
          <View
            style={[
              styles.checkbox,
              selected && {
                borderColor: accent,
                backgroundColor: accent,
              },
            ]}
          >
            {selected ? <MaterialCommunityIcons name="check" size={14} color={palette.white} /> : null}
          </View>
        ) : null}
      </View>

      {selected ? <View style={[styles.selectionGlow, { borderColor: `${accent}70` }]} pointerEvents="none" /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  shell: {
    overflow: "hidden",
    backgroundColor: palette.surfaceSoft,
    borderWidth: 1,
  },
  shellActive: {
    borderWidth: 2,
  },
  previewImage: {
    width: "100%",
    height: "100%",
    backgroundColor: palette.backgroundDeep,
  },
  previewFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  fallbackOrb: {
    position: "absolute",
    width: "72%",
    aspectRatio: 1,
    borderRadius: 999,
  },
  topOverlay: {
    position: "absolute",
    top: 8,
    right: 8,
  },
  playBadge: {
    position: "absolute",
    left: "50%",
    top: "50%",
    width: 34,
    height: 34,
    borderRadius: 17,
    marginLeft: -17,
    marginTop: -17,
    backgroundColor: "rgba(255,255,255,0.32)",
    alignItems: "center",
    justifyContent: "center",
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 0,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.88)",
    backgroundColor: "rgba(255,255,255,0.74)",
    alignItems: "center",
    justifyContent: "center",
  },
  selectionGlow: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 1,
  },
});
