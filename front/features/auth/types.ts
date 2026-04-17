export type UserRole = "child" | "youth" | "elder";
export type GuardianRelation = "self" | "parent" | "spouse" | "child" | "relative";

export type LocalImageAsset = {
  uri: string;
  name: string;
  mimeType: string;
};

export type UserPublic = {
  id: string;
  phone: string;
  display_name: string;
  role: UserRole;
  birth_date: string;
  avatar_url: string | null;
  guardian_relation: GuardianRelation | null;
  profile_summary: string | null;
  safety_score: number;
  memory_urgency_score: number;
};

export type TokenResponse = {
  access_token: string;
  token_type: string;
  user: UserPublic;
};

export type LoginPayload = {
  phone: string;
  password: string;
};

export type RegisterPayload = {
  phone: string;
  password: string;
  password_confirm: string;
  birth_date: string;
  display_name: string;
  role: UserRole;
  agree_terms: boolean;
  avatar_file?: LocalImageAsset | null;
};

export type UpdateGuardianPayload = {
  guardian_relation: GuardianRelation;
};

export type PushPlatform = "android" | "ios" | "web" | "unknown";

export type RegisterPushTokenPayload = {
  expo_push_token: string;
  platform: PushPlatform;
  device_name?: string | null;
};

export type PushTokenResponse = {
  expo_push_token: string;
  platform: PushPlatform;
  device_name: string | null;
  is_active: boolean;
};

export const roleMeta: Record<
  UserRole,
  {
    label: string;
    tone: string;
    detail: string;
  }
> = {
  child: {
    label: "未成年人守护",
    tone: "重点盯紧游戏交易、追星引流和陌生链接",
    detail: "优先提醒共享账号、诱导付费和陌生二维码。",
  },
  youth: {
    label: "日常防护",
    tone: "覆盖兼职、投资、征信和冒充客服",
    detail: "优先提醒验证码索取、转账诱导和远程协助。",
  },
  elder: {
    label: "长者守护",
    tone: "重点关注冒充亲友、保健推销和高额转账",
    detail: "优先提醒熟人求助、陌生来电和保健投资。",
  },
};

export const guardianMeta: Record<
  GuardianRelation,
  {
    label: string;
    detail: string;
  }
> = {
  self: {
    label: "本人管理",
    detail: "自己查看提醒",
  },
  parent: {
    label: "父母监护",
    detail: "适合家长代看",
  },
  spouse: {
    label: "配偶监护",
    detail: "适合伴侣互相提醒",
  },
  child: {
    label: "子女监护",
    detail: "适合家人守护长者",
  },
  relative: {
    label: "亲属监护",
    detail: "适合近亲协助",
  },
};
