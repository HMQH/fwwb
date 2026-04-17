export type GuardianBindingRelation = "self" | "parent" | "spouse" | "child" | "relative";
export type GuardianBindingStatus = "pending" | "active" | "revoked" | "rejected";
export type GuardianOwnership = "ward" | "guardian" | "self" | "viewer";
export type GuardianNotifyStatus = "pending" | "sent" | "read" | "failed";
export type GuardianActionType = "call" | "message" | "mark_safe" | "suggest_alarm" | "remote_assist";

export type GuardianConsentScope = {
  notify_levels: Array<"medium" | "high">;
};

export type GuardianBinding = {
  id: string;
  ward_user_id: string;
  guardian_user_id: string | null;
  ward_display_name: string | null;
  ward_phone: string | null;
  guardian_display_name: string | null;
  guardian_phone: string;
  guardian_name: string | null;
  relation: GuardianBindingRelation;
  status: GuardianBindingStatus;
  is_primary: boolean;
  consent_scope: GuardianConsentScope | Record<string, unknown>;
  verified_at: string | null;
  ownership: GuardianOwnership;
  created_at: string;
  updated_at: string;
};

export type GuardianIntervention = {
  id: string;
  risk_event_id: string;
  actor_user_id: string | null;
  actor_display_name: string | null;
  action_type: GuardianActionType;
  status: string;
  payload: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type GuardianEventSummary = {
  event_count: number;
  latest_event_id: string;
  latest_risk_level: string;
  latest_notify_status: GuardianNotifyStatus;
  latest_guardian_name: string | null;
  latest_guardian_phone: string | null;
  latest_guardian_relation: GuardianBindingRelation | null;
  latest_created_at: string;
  latest_acknowledged_at: string | null;
};

export type GuardianEvent = {
  id: string;
  ward_user_id: string;
  ward_display_name: string | null;
  ward_phone: string | null;
  guardian_binding_id: string;
  guardian_name: string | null;
  guardian_phone: string;
  guardian_relation: GuardianBindingRelation;
  binding_status: GuardianBindingStatus;
  ownership: GuardianOwnership;
  submission_id: string | null;
  detection_result_id: string | null;
  risk_level: string;
  fraud_type: string | null;
  summary: string;
  evidence_json: Record<string, unknown>;
  notify_status: GuardianNotifyStatus;
  notified_at: string | null;
  acknowledged_at: string | null;
  created_at: string;
  updated_at: string;
  interventions: GuardianIntervention[];
};

export type CreateGuardianBindingPayload = {
  guardian_phone: string;
  guardian_name?: string | null;
  relation: GuardianBindingRelation;
  consent_scope?: GuardianConsentScope;
  is_primary?: boolean;
};

export type CreateGuardianEventsPayload = {
  submission_id: string;
};

export type CreateGuardianInterventionPayload = {
  action_type: GuardianActionType;
  note?: string | null;
  payload?: Record<string, unknown>;
};

export const guardianRelationMeta: Record<
  GuardianBindingRelation,
  {
    label: string;
    short: string;
  }
> = {
  self: { label: "本人", short: "本人" },
  parent: { label: "父母", short: "父母" },
  spouse: { label: "配偶", short: "配偶" },
  child: { label: "子女", short: "子女" },
  relative: { label: "亲属", short: "亲属" },
};
