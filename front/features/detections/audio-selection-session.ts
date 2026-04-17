export type SelectedUploadedAudio = {
  id: string;
  upload_id: string;
  file_path: string;
  file_name: string;
  file_url: string | null;
  created_at: string;
  subtitle: string;
};

type AudioSelectionDraft = {
  items: SelectedUploadedAudio[];
  createdAt: number;
};

let draft: AudioSelectionDraft | null = null;

export function setSelectedUploadedAudioDraft(items: SelectedUploadedAudio[]) {
  draft = {
    items,
    createdAt: Date.now(),
  };
}

export function consumeSelectedUploadedAudioDraft() {
  const current = draft;
  draft = null;
  return current;
}

export function clearSelectedUploadedAudioDraft() {
  draft = null;
}
