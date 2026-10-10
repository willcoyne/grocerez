import { useFocusEffect } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Platform, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { color, radius } from '@/theme';

import { AppText } from './AppText';

/**
 * useToast(): { show(message: string): void }   // auto-hides after 2600 ms; a new toast replaces the current one
 * useToastBottomInset(px: number): void           // while the calling screen is focused, keep toasts at least
 *                                                 // `px` above the bottom (tab bar, List's Finish bar)
 */
export const TOAST_MS = 2600;
const FADE_MS = 150;
const SIDE = 16;

type ToastApi = { show: (message: string) => void; setInset: (id: string, px: number | null) => void };
const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const [message, setMessage] = useState<string | null>(null);
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
    (next: string) => {
      if (timer.current) clearTimeout(timer.current);
      setMessage(next);
      fade(1);
      if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(next);
      timer.current = setTimeout(() => fade(0, () => setMessage(null)), TOAST_MS);
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
      {message ? (
        <Animated.View
          testID="toast"
          pointerEvents="none"
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          style={[styles.toast, { bottom, opacity }]}>
          <AppText variant="bodyS" weight="semi" color="onPrimary">
            {message}
          </AppText>
        </Animated.View>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast(): { show: (message: string) => void } {
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
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 24,
  },
});
