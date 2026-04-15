import type { MemoryScope, RelationType } from "@/features/relations/types";

export type UploadRelationBinding = {
  relation_profile_id: string;
  relation_name: string;
  relation_type: RelationType | string;
  file_count: number;
};

export type UploadFileRelation = {
  relation_profile_id: string;
  relation_name: string;
  relation_type: RelationType | string;
};

export type UserUploadFile = {
  file_path: string;
  assigned: boolean;
  relations: UploadFileRelation[];
};

export type UserUpload = {
  id: string;
  user_id: string;
  storage_batch_id: string;
  upload_type: "text" | "audio" | "image" | "video" | string;
  file_paths: string[];
  files: UserUploadFile[];
  file_count: number;
  source_submission_id: string | null;
  created_at: string;
  updated_at: string;
  assigned_file_count: number;
  unassigned_file_count: number;
  bound_relations: UploadRelationBinding[];
};

export type AssignUploadPayload = {
  relation_profile_id: string;
  file_paths?: string[];
  memory_scope?: MemoryScope;
};
