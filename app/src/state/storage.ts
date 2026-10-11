import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

/**
 * Small key/value store: expo-secure-store on phones (Keychain / Keystore), localStorage on the web build
 * (secure-store has no web implementation; the web build is only for demos).
 */
export const storageKeys = {
  token: "grocerez.token",
  user: "grocerez.user",
  activeGroupId: "grocerez.activeGroupId",
  notificationsAsked: "grocerez.notificationsAsked",
} as const;

const web = Platform.OS === "web";

export const storage = {
  async get(key: string): Promise<string | null> {
    if (web) return globalThis.localStorage?.getItem(key) ?? null;
    return SecureStore.getItemAsync(key);
  },
  async set(key: string, value: string): Promise<void> {
    if (web) {
      globalThis.localStorage?.setItem(key, value);
      return;
    }
    await SecureStore.setItemAsync(key, value);
  },
  async remove(key: string): Promise<void> {
    if (web) {
      globalThis.localStorage?.removeItem(key);
      return;
    }
    await SecureStore.deleteItemAsync(key);
  },
};
