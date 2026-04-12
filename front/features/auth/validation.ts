export type LoginFormValues = {
  phone: string;
  password: string;
};

export type RegisterFormValues = {
  phone: string;
  displayName: string;
  birthDate: string;
  role: "child" | "youth" | "elder" | "";
  password: string;
  passwordConfirm: string;
  agreeTerms: boolean;
};

export type LoginFormErrors = Partial<Record<keyof LoginFormValues | "form", string>>;
export type RegisterFormErrors = Partial<
  Record<keyof RegisterFormValues | "form", string>
>;

const PHONE_RE = /^1\d{10}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function normalizePhone(value: string) {
  return value.replace(/\D/g, "").slice(0, 11);
}

export function formatBirthDateInput(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 8);

  if (digits.length <= 4) {
    return digits;
  }

  if (digits.length <= 6) {
    return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  }

  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
}

export function isValidBirthDate(value: string) {
  if (!DATE_RE.test(value)) {
    return false;
  }

  const [year, month, day] = value.split("-").map(Number);
  if (year < 1900) {
    return false;
  }

  const parsed = new Date(Date.UTC(year, month - 1, day));
  const isSameDate =
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day;

  if (!isSameDate) {
    return false;
  }

  const today = new Date();
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());

  return parsed.getTime() <= todayUtc;
}

export function validateLogin(values: LoginFormValues): LoginFormErrors {
  const errors: LoginFormErrors = {};

  if (!PHONE_RE.test(values.phone)) {
    errors.phone = "请输入以 1 开头的 11 位手机号";
  }

  if (!values.password.trim()) {
    errors.password = "请输入密码";
  }

  return errors;
}

export function validateRegister(values: RegisterFormValues): RegisterFormErrors {
  const errors: RegisterFormErrors = {};

  if (!PHONE_RE.test(values.phone)) {
    errors.phone = "请输入以 1 开头的 11 位手机号";
  }

  if (!values.displayName.trim()) {
    errors.displayName = "昵称不能为空";
  }

  if (!isValidBirthDate(values.birthDate)) {
    errors.birthDate = "请输入合法生日，格式为 YYYY-MM-DD";
  }

  if (!values.role) {
    errors.role = "请选择角色";
  }

  if (values.password.length < 8) {
    errors.password = "密码至少需要 8 位";
  }

  if (values.passwordConfirm !== values.password) {
    errors.passwordConfirm = "两次输入的密码不一致";
  }

  if (!values.agreeTerms) {
    errors.agreeTerms = "请先同意用户协议与隐私政策";
  }

  return errors;
}
