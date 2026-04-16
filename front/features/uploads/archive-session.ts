import type { GalleryAsset } from "./asset-utils";

type UploadArchiveDraft = {
  assets: GalleryAsset[];
  createdAt: number;
};

let draft: UploadArchiveDraft | null = null;

export function setUploadArchiveDraft(assets: GalleryAsset[]) {
  draft = {
    assets,
    createdAt: Date.now(),
  };
}

export function getUploadArchiveDraft() {
  return draft;
}

export function clearUploadArchiveDraft() {
  draft = null;
}
