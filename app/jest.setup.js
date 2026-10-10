/* global jest */
// Native modules that have no JS implementation under Jest.
jest.mock("@react-native-google-signin/google-signin", () => ({
  GoogleSignin: {
    configure: jest.fn(),
    hasPlayServices: jest.fn(async () => true),
    signIn: jest.fn(async () => ({ type: "success", data: { idToken: "google-id-token" } })),
    signOut: jest.fn(async () => null),
  },
  isErrorWithCode: () => false,
  statusCodes: { IN_PROGRESS: "IN_PROGRESS", PLAY_SERVICES_NOT_AVAILABLE: "PLAY_SERVICES_NOT_AVAILABLE" },
}));

jest.mock("expo-secure-store", () => {
  const store = new Map();
  return {
    getItemAsync: jest.fn(async (k) => (store.has(k) ? store.get(k) : null)),
    setItemAsync: jest.fn(async (k, v) => void store.set(k, v)),
    deleteItemAsync: jest.fn(async (k) => void store.delete(k)),
    __store: store,
  };
});

jest.mock("@react-native-community/netinfo", () => ({
  addEventListener: jest.fn(() => () => {}),
  fetch: jest.fn(async () => ({ isConnected: true })),
}));

jest.mock("socket.io-client", () => {
  const handlers = {};
  const socket = {
    connected: false,
    connect: jest.fn(),
    on: jest.fn((ev, fn) => {
      (handlers[ev] = handlers[ev] || []).push(fn);
      return socket;
    }),
    off: jest.fn(() => socket),
    emit: jest.fn(),
    removeAllListeners: jest.fn(),
    disconnect: jest.fn(),
    __handlers: handlers,
  };
  return { io: jest.fn(() => socket), __socket: socket };
});

jest.mock("react-native-safe-area-context", () => require("react-native-safe-area-context/jest/mock").default);

jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn(async () => true) }));
