export type {
  DetectionHistoryItem as RecordHistoryItem,
  DetectionSubmissionDetail as RecordDetail,
} from "@/features/detections/types";

export type RecordScope = "day" | "month" | "year";

export type RecordTrendPoint = {
  bucket_key: string;
  label: string;
  high: number;
  medium: number;
  low: number;
  total: number;
};

export type RecordStatistics = {
  scope: RecordScope | string;
  total_records: number;
  filtered_total: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  points: RecordTrendPoint[];
};
