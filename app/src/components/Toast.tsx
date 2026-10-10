import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, fontSize, radius, spacing, TAP_TARGET } from "@/theme";

interface ToastOptions {
  /** e.g. { label: "Undo", onPress } for the cabinet "ran out" snackbar. */
  action?: { label: string; onPress: () => void };
  durationMs?: number;
  tone?: "default" | "error";
}

interface ToastState extends ToastOptions {
  id: number;
  message: string;
}

const ToastContext = createContext<(message: string, opts?: ToastOptions) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const counter = useRef(0);
  const insets = useSafeAreaInsets();

  const show = useCallback((message: string, opts: ToastOptions = {}) => {
    counter.current += 1;
    setToast({ id: counter.current, message, ...opts });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast((cur) => (cur?.id === toast.id ? null : cur)), toast.durationMs ?? 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const value = useMemo(() => show, [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast ? (
        <View
          pointerEvents="box-none"
          style={[styles.wrap, { bottom: insets.bottom + 72 }]}
          accessibilityLiveRegion="polite"
        >
          <View style={[styles.toast, toast.tone === "error" && styles.error]} accessibilityRole="alert">
            <Text style={styles.text}>{toast.message}</Text>
            {toast.action ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={toast.action.label}
                style={styles.action}
                onPress={() => {
                  toast.action?.onPress();
                  setToast(null);
                }}
              >
                <Text style={styles.actionText}>{toast.action.label}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: spacing.lg, right: spacing.lg, alignItems: "center" },
  toast: {
    backgroundColor: colors.text,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    maxWidth: 520,
    width: "100%",
  },
  error: { backgroundColor: colors.danger },
  text: { color: colors.onPrimary, fontSize: fontSize.md, flex: 1, paddingVertical: spacing.xs },
  action: { minHeight: TAP_TARGET, justifyContent: "center", paddingHorizontal: spacing.sm },
  actionText: { color: "#A5D6A7", fontWeight: "700", fontSize: fontSize.md },
});
