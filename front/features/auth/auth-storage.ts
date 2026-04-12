import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import type { UserPublic } from "./types";

const TOKEN_KEY = "antifraud_token";
const USER_KEY = "antifraud_user";

function getWebStorage() {
  if (typeof localStorage === "undefined") {
    return null;
  }

  return localStorage;
}

async function getItem(key: string) {
  if (Platform.OS === "web") {
    return getWebStorage()?.getItem(key) ?? null;
  }

  return SecureStore.getItemAsync(key);
}

async function setItem(key: string, value: string) {
  if (Platform.OS === "web") {
    getWebStorage()?.setItem(key, value);
    return;
  }

  await SecureStore.setItemAsync(key, value);
}

async function deleteItem(key: string) {
  if (Platform.OS === "web") {
    getWebStorage()?.removeItem(key);
    return;
  }

  await SecureStore.deleteItemAsync(key);
}

export async function persistSession(token: string, user: UserPublic) {
  await Promise.all([setItem(TOKEN_KEY, token), setItem(USER_KEY, JSON.stringify(user))]);
}

export async function clearStoredSession() {
  await Promise.all([deleteItem(TOKEN_KEY), deleteItem(USER_KEY)]);
}

export async function getStoredToken() {
  return getItem(TOKEN_KEY);
}

export async function getStoredUser(): Promise<UserPublic | null> {
  const raw = await getItem(USER_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as UserPublic;
  } catch {
    return null;
  }
}
