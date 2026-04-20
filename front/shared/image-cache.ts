import * as FileSystem from "expo-file-system/legacy";
import { SaveFormat, manipulateAsync } from "expo-image-manipulator";
import { Image as ReactNativeImage, Platform } from "react-native";

export type ManagedImagePreset = "avatar" | "tile" | "preview" | "detail" | "upload";

export type ImageFileLike = {
  uri: string;
  name?: string | null;
  type?: string | null;
  mimeType?: string | null;
  width?: number | null;
  height?: number | null;
};

export type PreparedImageFile = {
  uri: string;
  name: string;
  type: string;
  mimeType: string;
  width?: number;
  height?: number;
};

type PresetConfig = {
  maxDimension: number;
  compress: number;
};

const PRESET_CONFIG: Record<ManagedImagePreset, PresetConfig> = {
  avatar: { maxDimension: 320, compress: 0.7 },
  tile: { maxDimension: 420, compress: 0.72 },
  preview: { maxDimension: 960, compress: 0.78 },
  detail: { maxDimension: 1280, compress: 0.82 },
  upload: { maxDimension: 1600, compress: 0.8 },
};

const MANAGED_IMAGE_DIR = `${FileSystem.documentDirectory ?? ""}managed-images`;
const remoteCacheTasks = new Map<string, Promise<string | null>>();

function isWeb() {
  return Platform.OS === "web";
}

export function isRemoteImageUri(uri?: string | null) {
  return typeof uri === "string" && /^https?:\/\//i.test(uri.trim());
}

function normalizeUri(uri?: string | null) {
  return typeof uri === "string" ? uri.trim() : "";
}

function stripQueryString(value: string) {
  return value.split("#")[0]?.split("?")[0] ?? value;
}

function getLeafName(value: string) {
  const normalized = stripQueryString(value).replace(/\\/g, "/");
  const leaf = normalized.split("/").pop() ?? normalized;
  try {
    return decodeURIComponent(leaf);
  } catch {
    return leaf;
  }
}

function replaceExtension(fileName: string, extension: string) {
  const normalized = fileName.replace(/\.[^.]+$/, "");
  return `${normalized || "image"}.${extension}`;
}

function getMimeHint(input: ImageFileLike | string) {
  if (typeof input === "string") {
    return getLeafName(input).toLowerCase();
  }
  return `${input.mimeType ?? input.type ?? ""} ${input.name ?? ""} ${getLeafName(input.uri)}`.toLowerCase();
}

function resolveSaveFormat(input: ImageFileLike | string) {
  const hint = getMimeHint(input);
  if (hint.includes("png")) {
    return SaveFormat.PNG;
  }
  if (hint.includes("webp")) {
    return SaveFormat.WEBP;
  }
  return SaveFormat.JPEG;
}

function formatToExtension(format: SaveFormat) {
  switch (format) {
    case SaveFormat.PNG:
      return "png";
    case SaveFormat.WEBP:
      return "webp";
    case SaveFormat.JPEG:
    default:
      return "jpg";
  }
}

function formatToMimeType(format: SaveFormat) {
  switch (format) {
    case SaveFormat.PNG:
      return "image/png";
    case SaveFormat.WEBP:
      return "image/webp";
    case SaveFormat.JPEG:
    default:
      return "image/jpeg";
  }
}

function hashText(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

async function ensureManagedImageDir() {
  if (!FileSystem.documentDirectory) {
    return null;
  }
  await FileSystem.makeDirectoryAsync(MANAGED_IMAGE_DIR, { intermediates: true }).catch(() => undefined);
  return MANAGED_IMAGE_DIR;
}

async function removeFileQuietly(uri?: string | null) {
  const target = normalizeUri(uri);
  if (!target) {
    return;
  }
  await FileSystem.deleteAsync(target, { idempotent: true }).catch(() => undefined);
}

async function fileExists(uri: string) {
  const info = await FileSystem.getInfoAsync(uri).catch(() => null);
  return Boolean(info?.exists);
}

async function getImageSize(uri: string) {
  return new Promise<{ width: number; height: number } | null>((resolve) => {
    ReactNativeImage.getSize(
      uri,
      (width, height) => resolve({ width, height }),
      () => resolve(null)
    );
  });
}

function buildResizeAction(size: { width: number; height: number } | null, maxDimension: number) {
  if (!size) {
    return [];
  }
  if (size.width <= maxDimension && size.height <= maxDimension) {
    return [];
  }
  return size.width >= size.height
    ? [{ resize: { width: maxDimension } }]
    : [{ resize: { height: maxDimension } }];
}

async function transformImage(
  sourceUri: string,
  preset: ManagedImagePreset,
  sourceHint: ImageFileLike | string,
  persistUri?: string | null
) {
  const format = resolveSaveFormat(sourceHint);
  const size = await getImageSize(sourceUri);
  const actions = buildResizeAction(size, PRESET_CONFIG[preset].maxDimension);
  const transformed = await manipulateAsync(sourceUri, actions, {
    compress: PRESET_CONFIG[preset].compress,
    format,
  });

  if (persistUri) {
    await FileSystem.copyAsync({ from: transformed.uri, to: persistUri });
    await removeFileQuietly(transformed.uri);
    return {
      uri: persistUri,
      width: transformed.width,
      height: transformed.height,
      format,
    };
  }

  return {
    uri: transformed.uri,
    width: transformed.width,
    height: transformed.height,
    format,
  };
}

function buildPreparedImageName(input: ImageFileLike, format: SaveFormat) {
  const fallbackName = input.name?.trim() || `image-${Date.now()}`;
  return replaceExtension(fallbackName, formatToExtension(format));
}

export async function prepareImageForUpload(
  input: ImageFileLike,
  preset: ManagedImagePreset = "upload"
): Promise<PreparedImageFile> {
  const uri = normalizeUri(input.uri);
  const fallback: PreparedImageFile = {
    uri,
    name: input.name?.trim() || `image-${Date.now()}.jpg`,
    type: input.type?.trim() || input.mimeType?.trim() || "image/jpeg",
    mimeType: input.mimeType?.trim() || input.type?.trim() || "image/jpeg",
    width: input.width ?? undefined,
    height: input.height ?? undefined,
  };

  if (!uri || isWeb() || isRemoteImageUri(uri)) {
    return fallback;
  }

  try {
    const format = resolveSaveFormat(input);
    const transformed = await transformImage(uri, preset, input);
    return {
      uri: transformed.uri,
      name: buildPreparedImageName(input, format),
      type: formatToMimeType(format),
      mimeType: formatToMimeType(format),
      width: transformed.width,
      height: transformed.height,
    };
  } catch {
    return fallback;
  }
}

function buildManagedCacheUri(uri: string, preset: ManagedImagePreset) {
  if (!FileSystem.documentDirectory) {
    return null;
  }
  const format = resolveSaveFormat(uri);
  const extension = formatToExtension(format);
  return `${MANAGED_IMAGE_DIR}/${hashText(`${preset}:${uri}`)}.${extension}`;
}

async function cacheRemoteImageInternal(uri: string, preset: ManagedImagePreset) {
  if (isWeb()) {
    return null;
  }

  const normalizedUri = normalizeUri(uri);
  if (!isRemoteImageUri(normalizedUri) || !FileSystem.cacheDirectory) {
    return null;
  }

  const managedDir = await ensureManagedImageDir();
  if (!managedDir) {
    return null;
  }

  const targetUri = buildManagedCacheUri(normalizedUri, preset);
  if (!targetUri) {
    return null;
  }

  if (await fileExists(targetUri)) {
    return targetUri;
  }

  const tempDownloadUri = `${FileSystem.cacheDirectory}${hashText(`${preset}:${normalizedUri}`)}-download`;

  try {
    const downloaded = await FileSystem.downloadAsync(normalizedUri, tempDownloadUri);
    try {
      const transformed = await transformImage(downloaded.uri, preset, normalizedUri, targetUri);
      return transformed.uri;
    } catch {
      await FileSystem.copyAsync({ from: downloaded.uri, to: targetUri });
      return targetUri;
    }
  } catch {
    return null;
  } finally {
    await removeFileQuietly(tempDownloadUri);
  }
}

export async function cacheRemoteImageToDevice(
  uri?: string | null,
  preset: ManagedImagePreset = "preview"
) {
  const normalizedUri = normalizeUri(uri);
  if (!isRemoteImageUri(normalizedUri)) {
    return null;
  }

  const taskKey = `${preset}:${normalizedUri}`;
  const cachedTask = remoteCacheTasks.get(taskKey);
  if (cachedTask) {
    return cachedTask;
  }

  const task = cacheRemoteImageInternal(normalizedUri, preset).finally(() => {
    remoteCacheTasks.delete(taskKey);
  });

  remoteCacheTasks.set(taskKey, task);
  return task;
}
