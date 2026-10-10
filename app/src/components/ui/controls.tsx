import { Check } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';

import { color, pressedOpacity, radius, size, space, type ColorName } from '@/theme';

import { AppText } from './AppText';
import { Button } from './Button';

// ---------- StatusChip ----------

export type ChipTone = 'ok' | 'warn' | 'danger' | 'neutral';
const tones: Record<ChipTone, { bg: string; fg: ColorName }> = {
  ok: { bg: color.okBg, fg: 'okFg' },
  warn: { bg: color.warnBg, fg: 'warnFg' },
  danger: { bg: color.dangerBg, fg: 'dangerFg' },
  neutral: { bg: color.segment, fg: 'ink2' },
};

/** Status chips always carry text (status is never color alone). `large` = 26 high (cabinet). */
export function StatusChip({ label, tone, large, testID }: { label: string; tone: ChipTone; large?: boolean; testID?: string }) {
  const t = tones[tone];
  return (
    <View testID={testID} style={[styles.chip, { minHeight: large ? size.statusChip : size.chip, backgroundColor: t.bg }]}>
      <AppText variant="micro" weight="bold" color={t.fg}>
        {label}
      </AppText>
    </View>
  );
}

// ---------- ToggleChip ----------

export function ToggleChip({
  label,
  selected,
  onPress,
  testID,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.toggle,
        selected ? styles.toggleOn : styles.toggleOff,
        pressed && { opacity: pressedOpacity },
      ]}>
      <AppText variant="bodyS" weight="semi" color={selected ? 'onPrimary' : 'ink'}>
        {label}
      </AppText>
    </Pressable>
  );
}

// ---------- Checkbox ----------

export function Checkbox({
  checked,
  onPress,
  name,
  testID,
}: {
  checked: boolean;
  onPress: () => void;
  /** Item name, used in the accessibility label. */
  name: string;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="checkbox"
      accessibilityLabel={checked ? `Uncheck ${name}` : `Check off ${name}`}
      accessibilityState={{ checked }}
      onPress={onPress}
      hitSlop={0}
      style={styles.checkHit}>
      <View style={[styles.checkBox, checked ? styles.checkOn : styles.checkOff]}>
        {checked ? <Check size={18} color={color.onPrimary} strokeWidth={3} /> : null}
      </View>
    </Pressable>
  );
}

// ---------- Segmented ----------

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  testID,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  testID?: string;
}) {
  return (
    <View style={styles.segTrack} accessibilityRole="tablist" testID={testID}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            testID={testID ? `${testID}-${o.value}` : undefined}
            accessibilityRole="tab"
            accessibilityLabel={o.label}
            accessibilityState={{ selected }}
            onPress={() => onChange(o.value)}
            style={[styles.segOption, selected && styles.segSelected]}>
            <AppText variant="bodyS" weight={selected ? 'bold' : 'semi'} color={selected ? 'ink' : 'ink2'} center>
              {o.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------- SuggestBanner ----------

/** "Did you mean {name}?" with Yes / No, add "{typed}". Sits directly under the field that triggered it. */
export function SuggestBanner({
  itemName,
  typed,
  onYes,
  onNo,
  busy,
  testID = 'suggest-banner',
}: {
  itemName: string;
  typed: string;
  onYes: () => void;
  onNo: () => void;
  busy?: boolean;
  testID?: string;
}) {
  return (
    <View style={styles.suggest} testID={testID} accessibilityLiveRegion="polite">
      <AppText variant="bodyL" weight="heavy">{`Did you mean ${itemName}?`}</AppText>
      <View style={styles.suggestRow}>
        <Button label="Yes" size="sm" onPress={onYes} disabled={busy} testID={`${testID}-yes`} />
        <Button label={`No, add "${typed}"`} size="sm" variant="secondary" onPress={onNo} disabled={busy} testID={`${testID}-no`} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: 'flex-start',
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  toggle: {
    minHeight: size.hit,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    justifyContent: 'center',
  },
  toggleOff: { backgroundColor: color.surface, borderColor: color.borderStrong },
  toggleOn: { backgroundColor: color.primary, borderColor: color.primary },
  checkHit: { width: size.hit, height: size.hit, alignItems: 'center', justifyContent: 'center' },
  checkBox: {
    width: size.checkbox,
    height: size.checkbox,
    borderRadius: radius.checkbox,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOff: { borderColor: color.checkboxIdle, backgroundColor: color.surface },
  checkOn: { borderColor: color.primary, backgroundColor: color.primary },
  segTrack: {
    flexDirection: 'row',
    backgroundColor: color.segment,
    padding: 4,
    borderRadius: radius.control,
  },
  segOption: { flex: 1, minHeight: size.hit, borderRadius: 9, justifyContent: 'center', paddingHorizontal: space.sm },
  segSelected: { backgroundColor: color.surface },
  suggest: {
    backgroundColor: color.suggestBg,
    borderWidth: 1,
    borderColor: color.suggestBorder,
    borderRadius: radius.control,
    padding: space.md,
    gap: space.sm,
  },
  suggestRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
