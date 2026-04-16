import type { RelationLinkedUpload } from "@/features/relations/types";
import type { UploadFileRelation, UserUpload } from "./types";

import { resolveUploadFileUrl } from "@/shared/api";

export type GalleryAsset = {
  id: string;
  upload_id: string;
  file_path: string;
  upload_type: string;
  file_url: string | null;
  created_at: string;
  updated_at: string;
  source_submission_id: string | null;
  assigned: boolean;
  relations: UploadFileRelation[];
  preview_url: string | null;
  file_name: string;
  title: string;
  subtitle: string;
  extension: string;
};

export type GallerySection = {
  key: string;
  label: string;
  items: GalleryAsset[];
};

const TYPE_LABEL: Record<string, string> = {
  text: "文本",
  audio: "音频",
  image: "图片",
  video: "视频",
};

export function getFileName(filePath: string) {
  const normalized = filePath.replace(/\\/g, "/");
  return normalized.split("/").pop() ?? filePath;
}

export function getFileExtension(filePath: string) {
  const name = getFileName(filePath);
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index + 1).toLowerCase() : "";
}

export function getAssetTypeLabel(uploadType: string) {
  return TYPE_LABEL[uploadType] ?? "文件";
}

export function isImageAsset(uploadType: string, filePath: string) {
  if (uploadType === "image") {
    return true;
  }
  const ext = getFileExtension(filePath);
  return ["jpg", "jpeg", "png", "webp", "gif", "bmp", "heic"].includes(ext);
}

export function looksMachineGenerated(fileName: string) {
  const normalized = fileName.replace(/\.[^.]+$/, "");
  return /^[a-f0-9-]{24,}$/i.test(normalized) || /^[a-z0-9_-]{24,}$/i.test(normalized);
}

function formatShortDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${mm}/${dd} ${hh}:${min}`;
}

export function formatAssetDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function formatAssetTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function formatSectionLabel(dayKey: string) {
  const today = formatAssetDate(new Date().toISOString());
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = formatAssetDate(yesterdayDate.toISOString());
  if (dayKey === today) {
    return "今天";
  }
  if (dayKey === yesterday) {
    return "昨天";
  }
  return dayKey;
}

export function formatAssetTitle(uploadType: string, filePath: string, createdAt: string) {
  const fileName = getFileName(filePath);
  const withoutExt = fileName.replace(/\.[^.]+$/, "");
  if (!looksMachineGenerated(fileName)) {
    return withoutExt.length > 22 ? `${withoutExt.slice(0, 22)}…` : withoutExt;
  }

  const label = getAssetTypeLabel(uploadType);
  const time = formatShortDateTime(createdAt);
  return time ? `${label} ${time}` : label;
}

export function formatAssetSubtitle(uploadType: string, filePath: string) {
  const ext = getFileExtension(filePath);
  const label = getAssetTypeLabel(uploadType);
  return ext ? `${label} · ${ext.toUpperCase()}` : label;
}

export function buildRelationCaption(relations: UploadFileRelation[]) {
  if (!relations.length) {
    return "未归档";
  }
  const names = relations.map((item) => item.relation_name);
  if (names.length <= 2) {
    return names.join(" · ");
  }
  return `${names.slice(0, 2).join(" · ")} +${names.length - 2}`;
}

export function flattenUserUploads(items: UserUpload[]) {
  return items.flatMap<GalleryAsset>((upload) => {
    const fileItems = upload.files.length
      ? upload.files
      : upload.file_paths.map((filePath) => ({ file_path: filePath, assigned: false, relations: [] }));

    return fileItems.map((file) => ({
      id: `${upload.id}:${file.file_path}`,
      upload_id: upload.id,
      file_path: file.file_path,
      upload_type: upload.upload_type,
      file_url: resolveUploadFileUrl(file.file_path),
      created_at: upload.created_at,
      updated_at: upload.updated_at,
      source_submission_id: upload.source_submission_id,
      assigned: file.assigned,
      relations: file.relations,
      preview_url: isImageAsset(upload.upload_type, file.file_path)
        ? resolveUploadFileUrl(file.file_path)
        : null,
      file_name: getFileName(file.file_path),
      title: formatAssetTitle(upload.upload_type, file.file_path, upload.created_at),
      subtitle: formatAssetSubtitle(upload.upload_type, file.file_path),
      extension: getFileExtension(file.file_path),
    }));
  });
}

export function flattenRelationUploads(items: RelationLinkedUpload[]) {
  return items.flatMap<GalleryAsset>((upload) =>
    upload.file_paths.map((filePath) => ({
      id: `${upload.user_upload_id}:${filePath}`,
      upload_id: upload.user_upload_id,
      file_path: filePath,
      upload_type: upload.upload_type,
      file_url: resolveUploadFileUrl(filePath),
      created_at: upload.created_at,
      updated_at: upload.updated_at,
      source_submission_id: upload.source_submission_id,
      assigned: true,
      relations: [],
      preview_url: isImageAsset(upload.upload_type, filePath) ? resolveUploadFileUrl(filePath) : null,
      file_name: getFileName(filePath),
      title: formatAssetTitle(upload.upload_type, filePath, upload.created_at),
      subtitle: formatAssetSubtitle(upload.upload_type, filePath),
      extension: getFileExtension(filePath),
    }))
  );
}

export function groupAssetsByDay(items: GalleryAsset[]) {
  const groups = new Map<string, GalleryAsset[]>();
  items.forEach((item) => {
    const key = formatAssetDate(item.created_at);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  });

  return Array.from(groups.entries()).map<GallerySection>(([key, assets]) => ({
    key,
    label: formatSectionLabel(key),
    items: assets,
  }));
}
