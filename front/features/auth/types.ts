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
    label: "未成年守护",
    tone: "重点关注游戏交易、追星引流与陌生链接",
    detail: "系统会优先提醒虚拟交易、账号共享、诱导付费和不明二维码场景。",
  },
  youth: {
    label: "日常防护",
    tone: "覆盖理财、兼职、征信与冒充客服类风险",
    detail: "系统会优先关注验证码索取、转账诱导、远程协助和异常投资话术。",
  },
  elder: {
    label: "长者守护",
    tone: "加重冒充亲友、保健推销与转账劝阻提醒",
    detail: "系统会优先突出大额转账、陌生来电、熟人求助和保健投资类风险。",
  },
};
