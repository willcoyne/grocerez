import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { LogoMark } from '@/components/brand/LogoMark';
import { AppText, Button } from '@/components/ui';
import { color, space } from '@/theme';

import type { SignInViewProps } from './useOnboarding';

/** DESIGN.md §4.1 SignIn. */
export function SignInView({ busy, onGoogle, demoUsers, onDemoUser }: SignInViewProps) {
  const [showDemo, setShowDemo] = useState(false);
  return (
    <ScrollView
      testID="screen-signin"
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled">
      <View style={styles.top}>
        <LogoMark />
        <AppText variant="hero" accessibilityRole="header">
          GrocerEZ
        </AppText>
        <AppText variant="lead" color="ink2" style={styles.tagline}>
          One shared grocery list for your household. Everyone adds what they want, and the app works out what to buy.
        </AppText>
      </View>

      <View style={styles.bottom}>
        <Button
          label="Continue with Google"
          variant="dark"
          size="lg"
          fullWidth
          loading={busy === 'google'}
          onPress={onGoogle}
          testID="signin-google"
        />
        <AppText variant="caption" color="muted" center>
          Household invites go to the email on your Google account.
        </AppText>

        {demoUsers.length > 0 ? (
          <View style={styles.demo}>
            <Button
              label="Demo users"
              variant="ghost"
              size="sm"
              onPress={() => setShowDemo((v) => !v)}
              accessibilityHint={showDemo ? 'Hides the demo sign-in list' : 'Shows a list of demo accounts'}
              testID="signin-demo-toggle"
            />
            {showDemo ? (
              <View style={styles.demoList}>
                {demoUsers.map((u) => (
                  <Button
                    key={u.id}
                    label={`Sign in as ${u.name}`}
                    variant="secondary"
                    size="sm"
                    loading={busy === u.id}
                    onPress={() => onDemoUser(u.id)}
                    testID={`demo-user-${u.id}`}
                  />
                ))}
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  content: {
    flexGrow: 1,
    justifyContent: 'space-between',
    paddingTop: 120,
    paddingHorizontal: 28,
    paddingBottom: 48,
    gap: 32,
  },
  top: { gap: space.xl },
  tagline: { maxWidth: 300 },
  bottom: { gap: space.md },
  demo: { alignItems: 'center', gap: space.sm },
  demoList: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space.sm },
});
