import { forwardRef, useId } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { color, font, maxFontScale, radius, size, space, typeScale } from '@/theme';

import { AppText } from './AppText';
import { Button, type ButtonVariant } from './Button';

type InputBase = Pick<
  TextInputProps,
  'value' | 'onChangeText' | 'onSubmitEditing' | 'placeholder' | 'keyboardType' | 'autoCapitalize' | 'autoFocus' | 'editable' | 'returnKeyType' | 'autoComplete'
>;

export type TextFieldProps = InputBase & {
  label: string;
  error?: string | null;
  testID?: string;
};

function FieldLabel({ label, nativeID }: { label: string; nativeID: string }) {
  return (
    <AppText nativeID={nativeID} variant="caption" weight="bold" color="ink2">
      {label}
    </AppText>
  );
}

function FieldError({ error }: { error?: string | null }) {
  if (!error) return null;
  return (
    <AppText accessibilityRole="alert" variant="caption" weight="bold" color="dangerFg">
      {error}
    </AppText>
  );
}

const Input = forwardRef<TextInput, InputBase & { labelId: string; label: string; testID?: string; invalid?: boolean }>(
  function Input({ labelId, label, testID, invalid, ...rest }, ref) {
    return (
      <TextInput
        ref={ref}
        testID={testID}
        accessibilityLabel={label}
        accessibilityLabelledBy={labelId}
        maxFontSizeMultiplier={maxFontScale}
        placeholderTextColor={color.muted}
        style={[styles.input, invalid && styles.inputInvalid]}
        {...rest}
      />
    );
  },
);

/** DESIGN.md §3 TextField: visible label above, 48-high input, error line below. */
export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField({ label, error, testID, ...rest }, ref) {
  const labelId = useId();
  return (
    <View style={styles.field}>
      <FieldLabel label={label} nativeID={labelId} />
      <Input ref={ref} labelId={labelId} label={label} testID={testID} invalid={!!error} {...rest} />
      <FieldError error={error} />
    </View>
  );
});

export type InlineAddProps = Omit<InputBase, 'onSubmitEditing'> & {
  label: string;
  /** Called on button press and keyboard return. */
  onSubmit: () => void;
  buttonLabel?: string;
  buttonVariant?: ButtonVariant;
  /** Disables the button while a request runs. */
  busy?: boolean;
  error?: string | null;
  testID?: string;
};

/** DESIGN.md §3 InlineAdd: a TextField and a Button in a row. Holds no state of its own. */
export function InlineAdd({
  label,
  onSubmit,
  buttonLabel = 'Add',
  buttonVariant = 'secondary',
  busy,
  error,
  testID,
  ...input
}: InlineAddProps) {
  const labelId = useId();
  return (
    <View style={styles.field} testID={testID}>
      <FieldLabel label={label} nativeID={labelId} />
      <View style={styles.row}>
        <View style={styles.flex}>
          <Input
            labelId={labelId}
            label={label}
            testID={testID ? `${testID}-input` : undefined}
            invalid={!!error}
            returnKeyType="done"
            onSubmitEditing={onSubmit}
            {...input}
          />
        </View>
        <Button
          label={buttonLabel}
          variant={buttonVariant}
          onPress={onSubmit}
          loading={busy}
          testID={testID ? `${testID}-button` : undefined}
          accessibilityLabel={`${buttonLabel}: ${label}`}
        />
      </View>
      <FieldError error={error} />
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 6 },
  row: { flexDirection: 'row', gap: space.sm, alignItems: 'stretch' },
  flex: { flex: 1 },
  input: {
    minHeight: size.input,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: color.borderStrong,
    backgroundColor: color.surface,
    paddingHorizontal: space.md,
    fontFamily: font.bodyMedium,
    fontSize: typeScale.body[0],
    color: color.ink,
  },
  inputInvalid: { borderColor: color.dangerFg },
});
