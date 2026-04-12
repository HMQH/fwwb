/** 与后端 SubmissionResponse 对齐（UUID 在 JSON 中为字符串） */
export type DetectionSubmitResponse = {
  id: string;
  user_id: string;
  storage_batch_id: string;
  has_text: boolean;
  has_audio: boolean;
  has_image: boolean;
  has_video: boolean;
  text_paths: string[];
  audio_paths: string[];
  image_paths: string[];
  video_paths: string[];
  text_content: string | null;
  created_at: string;
  updated_at: string;
};

/** React Native multipart 使用的本地文件描述 */
export type PickedFile = {
  uri: string;
  name: string;
  type: string;
};
