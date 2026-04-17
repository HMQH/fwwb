import { request } from "@/shared/api";

import type {
  AIFaceCheckResponse,
  AudioVerifyBatchJobResponse,
  AudioVerifyBatchJobSubmitResponse,
  AudioVerifyJobResponse,
  AudioVerifyJobSubmitResponse,
  AudioVerifyResponse,
  DetectionJob,
  DetectionSubmissionDetail,
  DetectionSubmitAcceptedResponse,
  PickedFile,
  WebPhishingPredictRequest,
  WebPhishingPredictResponse,
} from "./types";

const SUBMIT_TIMEOUT_MS = 300_000;

function appendRnFiles(form: FormData, fieldName: string, files: PickedFile[]) {
  for (const f of files) {
    form.append(
      fieldName,
      { uri: f.uri, name: f.name, type: f.type } as unknown as Blob
    );
  }
}

function buildAudioVerifyFormData(file: PickedFile): FormData {
  const form = new FormData();
  form.append(
    "audio_file",
    { uri: file.uri, name: file.name, type: file.type || "audio/wav" } as unknown as Blob
  );
  return form;
}

function buildAudioVerifyBatchFormData(files: PickedFile[]): FormData {
  const form = new FormData();
  for (const file of files) {
    form.append(
      "audio_files",
      { uri: file.uri, name: file.name, type: file.type || "audio/wav" } as unknown as Blob
    );
  }
  return form;
}

function buildWebPhishingUploadFormData(input: {
  url: string;
  htmlFile?: PickedFile | null;
  return_features?: boolean;
}): FormData {
  const form = new FormData();
  form.append("url", input.url.trim());
  form.append("return_features", String(Boolean(input.return_features)));
  if (input.htmlFile) {
    form.append(
      "html_file",
      {
        uri: input.htmlFile.uri,
        name: input.htmlFile.name,
        type: input.htmlFile.type || "text/html",
      } as unknown as Blob
    );
  }
  return form;
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

  verifyAudio(token: string, file: PickedFile) {
    return request<AudioVerifyResponse>(
      "/api/detections/audio/verify",
      { method: "POST", body: buildAudioVerifyFormData(file) },
      token,
      { timeoutMs: SUBMIT_TIMEOUT_MS }
    );
  },

  submitAudioVerify(token: string, file: PickedFile) {
    return request<AudioVerifyJobSubmitResponse>(
      "/api/detections/audio/verify/submit",
      { method: "POST", body: buildAudioVerifyFormData(file) },
      token,
      { timeoutMs: SUBMIT_TIMEOUT_MS }
    );
  },

  submitAudioVerifyBatch(token: string, files: PickedFile[]) {
    return request<AudioVerifyBatchJobSubmitResponse>(
      "/api/detections/audio/verify/batch/submit",
      { method: "POST", body: buildAudioVerifyBatchFormData(files) },
      token,
      { timeoutMs: SUBMIT_TIMEOUT_MS }
    );
  },

  submitAudioVerifyRecordFromUploads(
    token: string,
    input: {
      audio_paths: string[];
      relation_profile_id?: string | null;
    }
  ) {
    return request<DetectionSubmitAcceptedResponse>(
      "/api/detections/audio/verify/records/submit-from-uploads",
      { method: "POST", body: JSON.stringify(input) },
      token,
      { timeoutMs: SUBMIT_TIMEOUT_MS }
    );
  },

  getAudioVerifyJob(token: string, jobId: string) {
    return request<AudioVerifyJobResponse>(
      `/api/detections/audio/verify/jobs/${jobId}`,
      {},
      token
    );
  },

  getAudioVerifyBatchJob(token: string, batchId: string) {
    return request<AudioVerifyBatchJobResponse>(
      `/api/detections/audio/verify/batch/jobs/${batchId}`,
      {},
      token
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

  predictWebPhishing(token: string, payload: WebPhishingPredictRequest) {
    return request<WebPhishingPredictResponse>(
      "/api/detections/web/phishing/predict",
      { method: "POST", body: JSON.stringify(payload) },
      token,
      { timeoutMs: SUBMIT_TIMEOUT_MS }
    );
  },

  predictWebPhishingUpload(token: string, input: {
    url: string;
    htmlFile?: PickedFile | null;
    return_features?: boolean;
  }) {
    return request<WebPhishingPredictResponse>(
      "/api/detections/web/phishing/predict-upload",
      { method: "POST", body: buildWebPhishingUploadFormData(input) },
      token,
      { timeoutMs: SUBMIT_TIMEOUT_MS }
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
