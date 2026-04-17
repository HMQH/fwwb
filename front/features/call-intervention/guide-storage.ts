import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const CALL_GUIDE_PREFIX = "call_intervention_guide_seen_v1";
const PERMISSION_GUIDE_PREFIX = "call_intervention_permission_guide_seen_v1";

function getWebStorage() {
  if (typeof localStorage === "undefined") {
    return null;
  }
  return localStorage;
}

function sanitizeKeyPart(value: string) {
  const normalized = value.trim().replace(/[^A-Za-z0-9._-]/g, "_");
  return normalized || "anonymous";
}

function getScopedKey(prefix: string, userId: string) {
  return `${prefix}.${sanitizeKeyPart(userId)}`;
}

async function getFlag(prefix: string, userId: string) {
  const key = getScopedKey(prefix, userId);

  if (Platform.OS === "web") {
    return getWebStorage()?.getItem(key) === "1";
  }

  return (await SecureStore.getItemAsync(key)) === "1";
}

async function setFlag(prefix: string, userId: string) {
  const key = getScopedKey(prefix, userId);

  if (Platform.OS === "web") {
    getWebStorage()?.setItem(key, "1");
    return;
  }

  await SecureStore.setItemAsync(key, "1");
}

export function getCallGuideSeen(userId: string) {
  return getFlag(CALL_GUIDE_PREFIX, userId);
}

export function setCallGuideSeen(userId: string) {
  return setFlag(CALL_GUIDE_PREFIX, userId);
}

export function getCallPermissionGuideSeen(userId: string) {
  return getFlag(PERMISSION_GUIDE_PREFIX, userId);
}

export function setCallPermissionGuideSeen(userId: string) {
  return setFlag(PERMISSION_GUIDE_PREFIX, userId);
}
