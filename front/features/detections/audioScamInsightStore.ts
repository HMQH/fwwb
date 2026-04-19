import type { Href, Router } from "expo-router";
import { useSyncExternalStore } from "react";

import type { ScamCallInsight } from "./types";

type Snapshot = {
  insight: ScamCallInsight | null;
  sourceFilename: string | null;
  sourceAudioUri: string | null;
  sourceAudioMimeType: string | null;
  /** 关闭语音深度分析子页时应回到的检测详情等路由（如 `/records/:id`） */
  returnHref: string | null;
  updatedAt: number | null;
};

let snapshot: Snapshot = {
  insight: null,
  sourceFilename: null,
  sourceAudioUri: null,
  sourceAudioMimeType: null,
  returnHref: null,
  updatedAt: null,
};

const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

export function setAudioScamInsight(
  insight: ScamCallInsight,
  options?: {
    sourceFilename?: string | null;
    sourceAudioUri?: string | null;
    sourceAudioMimeType?: string | null;
    returnHref?: string | null;
  }
) {
  snapshot = {
    insight,
    sourceFilename: options?.sourceFilename ?? null,
    sourceAudioUri: options?.sourceAudioUri ?? null,
    sourceAudioMimeType: options?.sourceAudioMimeType ?? null,
    returnHref: options?.returnHref !== undefined ? options.returnHref : snapshot.returnHref,
    updatedAt: Date.now(),
  };
  emit();
}

export function clearAudioScamInsight() {
  snapshot = {
    insight: null,
    sourceFilename: null,
    sourceAudioUri: null,
    sourceAudioMimeType: null,
    returnHref: null,
    updatedAt: null,
  };
  emit();
}

export function getAudioScamInsightSnapshot() {
  return snapshot;
}

export function useAudioScamInsightSnapshot() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot,
    () => snapshot
  );
}

/** 语音深度分析各子页顶部返回：优先回到传入的检测详情，否则系统返回上一屏 */
export function navigateAudioInsightBack(router: Router) {
  const href = snapshot.returnHref?.trim();
  if (href) {
    router.replace(href as Href);
    return;
  }
  router.back();
}
