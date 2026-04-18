import type { ImageSourcePropType } from "react-native";

export type UserRole =
  | "office_worker"
  | "student"
  | "mother"
  | "investor"
  | "minor"
  | "young_social"
  | "elder"
  | "finance";

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

export type RoleMeta = {
  label: string;
  tone: string;
  detail: string;
  highlights: string[];
  image: ImageSourcePropType;
  accent: string;
  soft: string;
};

export const roleMeta: Record<UserRole, RoleMeta> = {
  office_worker: {
    label: "上班族",
    tone: "客服、退款、征信、贷款",
    detail: "客服退款、共享屏幕、验证码",
    highlights: ["客服退款", "共享屏幕", "验证码"],
    image: require("../../assets/images/上班族.png"),
    accent: "#2F70E6",
    soft: "#EAF2FF",
  },
  student: {
    label: "大学生",
    tone: "兼职、培训、租房、二手",
    detail: "兼职返利、培训费、租房定金",
    highlights: ["兼职返利", "培训费", "租房定金"],
    image: require("../../assets/images/大学生.png"),
    accent: "#5B7CFA",
    soft: "#EEF1FF",
  },
  mother: {
    label: "宝妈",
    tone: "快递、退款、学费、团购",
    detail: "快递异常、退费补偿、亲子缴费",
    highlights: ["快递异常", "退费补偿", "亲子缴费"],
    image: require("../../assets/images/宝妈.png"),
    accent: "#E06F91",
    soft: "#FFF0F5",
  },
  investor: {
    label: "投资者",
    tone: "荐股、带单、假平台、高收益",
    detail: "内幕消息、老师带单、陌生入金",
    highlights: ["老师带单", "高收益", "陌生入金"],
    image: require("../../assets/images/投资者.png"),
    accent: "#4F7BFF",
    soft: "#EEF3FF",
  },
  minor: {
    label: "未成年",
    tone: "游戏、追星、私聊、扫码",
    detail: "游戏交易、追星福利、私下转账",
    highlights: ["游戏交易", "追星福利", "私下转账"],
    image: require("../../assets/images/未成年.png"),
    accent: "#688BFF",
    soft: "#EEF2FF",
  },
  young_social: {
    label: "潮流青年",
    tone: "社交、抽奖、福利、引流",
    detail: "社交福利、私聊引流、平台外交易",
    highlights: ["社交福利", "私聊引流", "平台外交易"],
    image: require("../../assets/images/潮流青年.png"),
    accent: "#8A63F7",
    soft: "#F2EEFF",
  },
  elder: {
    label: "老年人",
    tone: "冒充亲友、养老、保健、补贴",
    detail: "冒充亲友、保健投资、补贴通知",
    highlights: ["冒充亲友", "保健投资", "补贴通知"],
    image: require("../../assets/images/老年人.png"),
    accent: "#D68A1F",
    soft: "#FFF4E5",
  },
  finance: {
    label: "财务",
    tone: "公对公、变更账户、紧急付款",
    detail: "账户变更、紧急付款、合同附件",
    highlights: ["账户变更", "紧急付款", "合同附件"],
    image: require("../../assets/images/财务.png"),
    accent: "#356AD8",
    soft: "#EAF1FF",
  },
};

export const roleOrder: UserRole[] = [
  "office_worker",
  "student",
  "mother",
  "investor",
  "minor",
  "young_social",
  "elder",
  "finance",
];

export const roleOptions = roleOrder.map((value) => ({
  value,
  ...roleMeta[value],
}));

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
    detail: "适合家人守护老人",
  },
  relative: {
    label: "亲属监护",
    detail: "适合近亲协助",
  },
};
