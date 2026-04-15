import { request } from "@/shared/api";

import type {
  AIFaceCheckResponse,
  DetectionJob,
  DetectionSubmissionDetail,
  DetectionSubmitAcceptedResponse,
  PickedFile,
} from "./types";

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
  relation_profile_id?: string | null;
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
  if (input.relation_profile_id) {
    form.append("relation_profile_id", input.relation_profile_id);
  }
  appendRnFiles(form, "text_files", input.text_files ?? []);
  appendRnFiles(form, "audio_files", input.audio_files ?? []);
  appendRnFiles(form, "image_files", input.image_files ?? []);
  appendRnFiles(form, "video_files", input.video_files ?? []);
  return form;
}

export const detectionsApi = {
  submit(token: string, form: FormData) {
    return request<DetectionSubmitAcceptedResponse>(
      "/api/detections/submit",
      { method: "POST", body: form },
      token,
      { timeoutMs: SUBMIT_TIMEOUT_MS }
    );
  },

  getJob(token: string, jobId: string) {
    return request<DetectionJob>(`/api/detections/jobs/${jobId}`, {}, token);
  },

  getSubmission(token: string, submissionId: string) {
    return request<DetectionSubmissionDetail>(
      `/api/detections/submissions/${submissionId}`,
      {},
      token
    );
  },

  rerun(token: string, submissionId: string) {
    return request<DetectionJob>(
      `/api/detections/submissions/${submissionId}/run`,
      { method: "POST" },
      token
    );
  },

  checkAIFace(token: string, imageFile: PickedFile) {
    const form = new FormData();
    form.append(
      "image_file",
      { uri: imageFile.uri, name: imageFile.name, type: imageFile.type } as unknown as Blob
    );

    return request<AIFaceCheckResponse>(
      "/api/detections/ai-face/check",
      { method: "POST", body: form },
      token,
      { timeoutMs: SUBMIT_TIMEOUT_MS }
    );
  },
};
