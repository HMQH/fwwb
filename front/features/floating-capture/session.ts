import type { UserUpload } from "@/features/uploads/types";

export type FloatingCaptureFile = {
  uri: string;
  name: string;
  type: string;
};

export type FloatingCaptureTarget = "ai-face" | "visual";

export type FloatingCaptureDraft = {
  file: FloatingCaptureFile;
  upload: UserUpload | null;
  target: FloatingCaptureTarget | null;
  createdAt: number;
};

let recentDraft: FloatingCaptureDraft | null = null;

export function setRecentFloatingCaptureDraft(input: {
  file: FloatingCaptureFile;
  upload?: UserUpload | null;
  target?: FloatingCaptureTarget | null;
}) {
  recentDraft = {
    file: input.file,
    upload: input.upload ?? null,
    target: input.target ?? null,
    createdAt: Date.now(),
  };
}

export function patchRecentFloatingCaptureUpload(upload: UserUpload | null) {
  if (!recentDraft) {
    return;
  }
  recentDraft = {
    ...recentDraft,
    upload,
  };
}

export function peekRecentFloatingCaptureDraft() {
  return recentDraft;
}

export function stageRecentFloatingCapture(target: FloatingCaptureTarget) {
  if (!recentDraft) {
    return;
  }
  recentDraft = {
    ...recentDraft,
    target,
  };
}

export function consumeStagedFloatingCapture(target: FloatingCaptureTarget) {
  if (!recentDraft || recentDraft.target !== target) {
    return null;
  }
  const draft = recentDraft;
  recentDraft = null;
  return draft;
}

export function clearRecentFloatingCaptureDraft() {
  recentDraft = null;
}
