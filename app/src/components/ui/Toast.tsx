import { useFocusEffect } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Platform, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { color, radius, size } from '@/theme';

import { AppText } from './AppText';

/**
 * useToast(): { show(message, opts?): void }    // auto-hides after 2600 ms; a new toast replaces the current one.
 *                                                 // opts.action adds a button (e.g. Undo); opts.tone 'error' uses dangerFg.
 * useToastBottomInset(px: number): void           // while the calling screen is focused, keep toasts at least
 *                                                 // `px` above the bottom (tab bar, List's Finish bar)
 */
export const TOAST_MS = 2600;
const FADE_MS = 150;
const SIDE = 16;

export type ToastOptions = { action?: { label: string; onPress: () => void }; tone?: 'default' | 'error'; durationMs?: number };
type ShowToast = (message: string, opts?: ToastOptions) => void;
type ToastApi = { show: ShowToast; setInset: (id: string, px: number | null) => void };
const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<({ message: string } & ToastOptions) | null>(null);
  const [bottoms, setBottoms] = useState<Record<string, number>>({});
  const [opacity] = useState(() => new Animated.Value(0));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reduceMotion = useRef(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => (reduceMotion.current = v))
      .catch(() => {});
  }, []);

  const fade = useCallback(
    (to: number, done?: () => void) => {
      if (reduceMotion.current || process.env.JEST_WORKER_ID) {
        opacity.setValue(to);
        done?.();
        return;
      }
      Animated.timing(opacity, { toValue: to, duration: FADE_MS, useNativeDriver: Platform.OS !== 'web' }).start(() => done?.());
    },
    [opacity],
  );

  const show = useCallback(
    (next: string, opts: ToastOptions = {}) => {
      if (timer.current) clearTimeout(timer.current);
      setToast({ message: next, ...opts });
      fade(1);
      if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(next);
      const ms = opts.durationMs ?? (opts.action ? TOAST_MS * 2 : TOAST_MS);
      timer.current = setTimeout(() => fade(0, () => setToast(null)), ms);
    },
    [fade],
  );

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const setInset = useCallback((id: string, px: number | null) => {
    setBottoms((cur) => {
      const next = { ...cur };
      if (px === null) delete next[id];
      else next[id] = px;
      return next;
    });
  }, []);

  const api = useMemo(() => ({ show, setInset }), [show, setInset]);
  const bottom = Math.max(insets.bottom + SIDE, ...Object.values(bottoms).map((b) => b + SIDE));

  return (
    <ToastContext.Provider value={api}>
      {children}
      {toast ? (
        <Animated.View
          testID="toast"
          pointerEvents={toast.action ? 'box-none' : 'none'}
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          style={[styles.toast, toast.tone === 'error' && styles.error, { bottom, opacity }]}>
          <AppText variant="bodyS" weight="semi" color="onPrimary" style={styles.text}>
            {toast.message}
          </AppText>
          {toast.action ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={toast.action.label}
              style={styles.action}
              onPress={() => {
                toast.action?.onPress();
                if (timer.current) clearTimeout(timer.current);
                setToast(null);
              }}>
              <AppText variant="bodyS" weight="heavy" color="onPrimary" uppercase>
                {toast.action.label}
              </AppText>
            </Pressable>
          ) : null}
        </Animated.View>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast(): { show: ShowToast } {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return { show: ctx.show };
}

let insetSeq = 0;
export function useToastBottomInset(px: number) {
  const ctx = useContext(ToastContext);
  const id = useRef(`inset-${++insetSeq}`).current;
  const setInset = ctx?.setInset;
  useFocusEffect(
    useCallback(() => {
      setInset?.(id, px);
      return () => setInset?.(id, null);
    }, [setInset, id, px]),
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    left: SIDE,
    right: SIDE,
    backgroundColor: color.ink,
    borderRadius: radius.control,
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 24,
  },
  error: { backgroundColor: color.dangerFg },
  text: { flex: 1 },
  action: { minHeight: size.hit, minWidth: size.hit, justifyContent: 'center', marginVertical: -10 },
});
