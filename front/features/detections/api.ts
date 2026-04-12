import { request } from "@/shared/api";

import type { DetectionSubmitResponse, PickedFile } from "./types";

const SUBMIT_TIMEOUT_MS = 120_000;

function appendRnFiles(form: FormData, fieldName: string, files: PickedFile[]) {
  for (const f of files) {
    form.append(
      fieldName,
      { uri: f.uri, name: f.name, type: f.type } as unknown as Blob
    );
  }
}

export function buildDetectionSubmitFormData(input: {
  text_content?: string;
  text_files?: PickedFile[];
  audio_files?: PickedFile[];
  image_files?: PickedFile[];
  video_files?: PickedFile[];
}): FormData {
  const form = new FormData();
  const tc = input.text_content?.trim();
  if (tc) {
    form.append("text_content", tc);
  }
  appendRnFiles(form, "text_files", input.text_files ?? []);
  appendRnFiles(form, "audio_files", input.audio_files ?? []);
  appendRnFiles(form, "image_files", input.image_files ?? []);
  appendRnFiles(form, "video_files", input.video_files ?? []);
  return form;
}

export const detectionsApi = {
  submit(token: string, form: FormData) {
    return request<DetectionSubmitResponse>(
      "/api/detections/submit",
      { method: "POST", body: form },
      token,
      { timeoutMs: SUBMIT_TIMEOUT_MS }
    );
  },
};
