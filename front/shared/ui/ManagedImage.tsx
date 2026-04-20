import { Image, type ImageProps } from "expo-image";
import { useEffect, useMemo, useState } from "react";

import { cacheRemoteImageToDevice, isRemoteImageUri, type ManagedImagePreset } from "@/shared/image-cache";

type ManagedImageProps = ImageProps & {
  imagePreset?: ManagedImagePreset;
  persistToDevice?: boolean;
};

function extractUri(source: ImageProps["source"]) {
  if (typeof source === "string") {
    return source;
  }
  if (Array.isArray(source) || !source || typeof source !== "object") {
    return null;
  }
  if (!("uri" in source)) {
    return null;
  }
  return typeof source.uri === "string" ? source.uri : null;
}

function rebuildSource(source: ImageProps["source"], nextUri: string | null) {
  if (!nextUri) {
    return source;
  }
  if (typeof source === "string") {
    return { uri: nextUri };
  }
  if (Array.isArray(source) || !source || typeof source !== "object") {
    return source;
  }
  if (!("uri" in source)) {
    return source;
  }
  return {
    ...source,
    uri: nextUri,
  };
}

export function ManagedImage({
  source,
  imagePreset = "preview",
  persistToDevice = true,
  cachePolicy,
  ...rest
}: ManagedImageProps) {
  const sourceUri = extractUri(source);
  const shouldPersist = persistToDevice && isRemoteImageUri(sourceUri);
  const [resolvedUri, setResolvedUri] = useState<string | null>(sourceUri);

  useEffect(() => {
    let active = true;
    setResolvedUri(sourceUri);

    if (!shouldPersist || !sourceUri) {
      return () => {
        active = false;
      };
    }

    void cacheRemoteImageToDevice(sourceUri, imagePreset).then((cachedUri) => {
      if (active && cachedUri) {
        setResolvedUri(cachedUri);
      }
    });

    return () => {
      active = false;
    };
  }, [imagePreset, shouldPersist, sourceUri]);

  const finalSource = useMemo(() => rebuildSource(source, resolvedUri), [resolvedUri, source]);

  return (
    <Image
      {...rest}
      source={finalSource}
      cachePolicy={cachePolicy ?? (shouldPersist ? "memory-disk" : undefined)}
    />
  );
}
