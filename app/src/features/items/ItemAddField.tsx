import type { Item } from '@contracts/models';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { InlineAdd, SuggestBanner, useToast, type ButtonVariant } from '@/components/ui';
import { space } from '@/theme';

import { useResolveItem } from './useResolveItem';

/**
 * InlineAdd + the §5 resolution flow + the "Did you mean" banner directly under the field.
 *
 * <ItemAddField
 *   label placeholder buttonVariant testID
 *   onItem={(item: Item) => Promise<void>}   // add it (POST …) and show the success/duplicate toast
 * />
 * Clears the text after onItem resolves. Editing the text dismisses the banner.
 * API failures show the toast "Something went wrong. Try again."
 */
export function ItemAddField({
  label,
  placeholder,
  buttonVariant = 'secondary',
  testID,
  onItem,
}: {
  label: string;
  placeholder?: string;
  buttonVariant?: ButtonVariant;
  testID?: string;
  onItem: (item: Item) => Promise<void> | void;
}) {
  const [text, setText] = useState('');
  const toast = useToast();
  const resolver = useResolveItem(async (item) => {
    await onItem(item);
    setText('');
  });

  const guard = (p: Promise<void>) =>
    p.catch(() => {
      toast.show('Something went wrong. Try again.');
    });

  return (
    <View style={styles.wrap}>
      <InlineAdd
        label={label}
        placeholder={placeholder}
        value={text}
        onChangeText={(t) => {
          setText(t);
          resolver.dismiss();
        }}
        onSubmit={() => void guard(resolver.resolve(text))}
        buttonVariant={buttonVariant}
        busy={resolver.busy && !resolver.suggestion}
        autoCapitalize="none"
        testID={testID}
      />
      {resolver.suggestion ? (
        <SuggestBanner
          itemName={resolver.suggestion.item.name}
          typed={resolver.suggestion.typed}
          onYes={() => void guard(resolver.accept())}
          onNo={() => void guard(resolver.reject())}
          busy={resolver.busy}
          testID={testID ? `${testID}-suggest` : undefined}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
});
