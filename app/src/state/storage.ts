import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// Small key/value store: SecureStore on device, localStorage on web. Failures read as "nothing stored".

export const storageKeys = {
  token: 'grocerez.session.token',
  activeGroupId: 'grocerez.activeGroupId',
} as const;

export async function getItem(key: string): Promise<string | null> {
  try {
    if (Platform.OS === 'web') return globalThis.localStorage?.getItem(key) ?? null;
    return (await SecureStore.getItemAsync(key)) ?? null;
  } catch {
    return null;
  }
}

export async function setItem(key: string, value: string): Promise<void> {
  try {
    if (Platform.OS === 'web') globalThis.localStorage?.setItem(key, value);
    else await SecureStore.setItemAsync(key, value);
  } catch {
    // Not fatal: the session just won't survive a restart.
  }
}

export async function deleteItem(key: string): Promise<void> {
  try {
    if (Platform.OS === 'web') globalThis.localStorage?.removeItem(key);
    else await SecureStore.deleteItemAsync(key);
  } catch {
    // ignore
  }
}
