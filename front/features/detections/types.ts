export type DetectionMode = "text" | "visual" | "audio" | "mixed";

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

export type PickedFile = {
  uri: string;
  name: string;
  type: string;
};
