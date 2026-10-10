// Jest runs every test in mock mode unless a test opts out (see src/api/__tests__/client.test.ts).
process.env.EXPO_PUBLIC_USE_MOCK = '1';

// In-memory SecureStore so session code runs under Jest.
jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: jest.fn(async (k: string) => store.get(k) ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => void store.set(k, v)),
    deleteItemAsync: jest.fn(async (k: string) => void store.delete(k)),
    __store: store,
  };
});
