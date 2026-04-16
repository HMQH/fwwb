import { resolveApiFileUrl } from "@/shared/api";

import type { DetectionEvidence } from "./types";

const REFERENCE_PREFIXES = [
  "/reference-images/",
  "reference-images/",
  "fraud_source/image_fraud/",
  "image_fraud/",
];

function encodePathSegments(path: string) {
  return path
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function normalizeReferenceRelativePath(raw?: string | null) {
  if (!raw) {
    return null;
  }

  const normalized = raw.trim().replace(/\\/g, "/");
  if (!normalized) {
    return null;
  }

  for (const prefix of REFERENCE_PREFIXES) {
    const index = normalized.indexOf(prefix);
    if (index >= 0) {
      const relativePath = normalized.slice(index + prefix.length).replace(/^\/+/, "");
      return relativePath || null;
    }
  }

  if (/^[^/]+\.(png|jpe?g|webp|gif|bmp)$/i.test(normalized)) {
    return normalized;
  }

  return null;
}

function resolveReferencePreviewUrl(raw?: string | null) {
  const relativePath = normalizeReferenceRelativePath(raw);
  if (!relativePath) {
    return null;
  }

  return resolveApiFileUrl(`/reference-images/${encodePathSegments(relativePath)}`);
}

function looksLikeImageUrl(url: string) {
  return /\.(png|jpe?g|webp|gif|bmp)(?:$|[?#])/i.test(url);
}

export function resolveEvidencePreviewUrl(item: DetectionEvidence) {
  if (item.url) {
    if (/^https?:\/\//i.test(item.url)) {
      return looksLikeImageUrl(item.url) ? item.url : null;
    }

    const previewFromUrl = resolveReferencePreviewUrl(item.url);
    if (previewFromUrl) {
      return previewFromUrl;
    }
  }

  if (item.match_source !== "image_similarity") {
    return null;
  }

  return resolveReferencePreviewUrl(item.reason);
}

export function resolveEvidenceLinkUrl(item: DetectionEvidence) {
  const previewUrl = resolveEvidencePreviewUrl(item);
  if (previewUrl) {
    return previewUrl;
  }

  return resolveApiFileUrl(item.url);
}

export function getEvidenceReasonText(item: DetectionEvidence) {
  if (item.match_source === "image_similarity" && resolveEvidencePreviewUrl(item)) {
    return null;
  }

  const reason = item.reason?.trim();
  return reason ? reason : null;
}
