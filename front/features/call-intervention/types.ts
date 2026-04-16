export type RiskLevel = "low" | "medium" | "high";

export type IncomingRiskEvent = {
  callId: string;
  phoneNumber: string;
  riskLevel: RiskLevel;
  labels: string[];
  message: string;
  suggestedAction?: string | null;
};

export type RecordingStatus = {
  status: "idle" | "recording" | "stopped";
  callId: string | null;
  phoneNumber: string | null;
  riskLevel: RiskLevel;
  isRecording: boolean;
  finalFilePath: string | null;
  segmentCount: number;
  durationMs: number;
  captureMode?: string | null;
  captureSource?: string | null;
  captureHint?: string | null;
  speakerphoneRequired?: boolean;
  reason?: string | null;
};

export type AudioChunkEvent = {
  callId: string;
  seq: number;
  sampleRate: number;
  channelCount: number;
  encoding: "pcm16";
  durationMs: number;
  chunkBase64: string;
};

export type NativeRiskWarningEvent = {
  level: RiskLevel;
  message: string;
};

export type NativeDetectionStatus = {
  callScreeningEnabled: boolean;
  canRequestCallScreeningRole: boolean;
  phoneStatePermissionGranted: boolean;
  contactsPermissionGranted: boolean;
  overlayPermissionGranted: boolean;
  recordAudioPermissionGranted: boolean;
  notificationPermissionGranted: boolean;
};

export type LookupNumberPayload = {
  phone_number: string;
  area_code?: string | null;
  call_started_at?: string | null;
};

export type LookupNumberResult = {
  phone_number: string;
  risk_level: RiskLevel;
  score: number;
  labels: string[];
  suggestion: string;
  source: string;
};

export type CallSessionStartPayload = {
  phone_number: string;
  call_direction: "incoming" | "outgoing";
  risk_level_initial: RiskLevel;
  risk_labels: string[];
};

export type CallSessionStopPayload = {
  session_id: string;
  risk_level_final?: RiskLevel;
  summary?: string;
  transcript_full_text?: string;
  audio_duration_ms?: number;
  audio_file_url?: string;
  audio_object_key?: string;
};

export type TranscriptSegment = {
  id: string;
  session_id?: string;
  seq: number;
  start_ms: number;
  end_ms: number;
  text: string;
  confidence?: number | null;
  is_final: boolean;
  created_at?: string;
};

export type RiskEvent = {
  id: string;
  session_id?: string;
  event_type?: string;
  risk_level: RiskLevel;
  matched_rule: string;
  message: string;
  payload?: Record<string, unknown> | unknown[] | null;
  created_at: string;
};

export type CallSession = {
  id: string;
  user_id: string;
  phone_number: string;
  call_direction: "incoming" | "outgoing";
  risk_level_initial: RiskLevel;
  risk_level_final: RiskLevel;
  risk_labels: string[];
  recording_status: string;
  transcript_status: string;
  provider_session_key?: string | null;
  transcript_full_text?: string | null;
  summary?: string | null;
  audio_file_url?: string | null;
  audio_object_key?: string | null;
  audio_duration_ms?: number | null;
  started_at: string;
  ended_at?: string | null;
  created_at: string;
  updated_at: string;
  segments: TranscriptSegment[];
  risk_events: RiskEvent[];
};

export type WsTranscriptMessage = {
  type: "transcript";
  segment: TranscriptSegment;
};

export type WsTranscriptPartialMessage = {
  type: "transcript_partial";
  segment: TranscriptSegment;
};

export type WsRiskEventMessage = {
  type: "risk_event";
  event: RiskEvent;
};

export type WsReadyMessage = {
  type: "ready";
  session_id: string;
};

export type WsErrorMessage = {
  type: "error";
  message: string;
};

export type WsMessage =
  | WsTranscriptMessage
  | WsTranscriptPartialMessage
  | WsRiskEventMessage
  | WsReadyMessage
  | WsErrorMessage
  | { type: string; [key: string]: unknown };
