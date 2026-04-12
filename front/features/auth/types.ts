export type UserRole = "child" | "youth" | "elder";

export type UserPublic = {
  id: string;
  phone: string;
  display_name: string;
  role: UserRole;
  birth_date: string;
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
  agree_terms: boolean;
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
    label: "儿童",
    tone: "轻量守护",
    detail: "后端根据生日自动识别，便于后续做更细的反诈提示。",
  },
  youth: {
    label: "青壮年",
    tone: "标准防护",
    detail: "适合默认主流程，后续可承接更多风险识别能力。",
  },
  elder: {
    label: "老年",
    tone: "重点陪伴",
    detail: "为高风险人群预留更醒目的提醒和家属联动能力。",
  },
};
