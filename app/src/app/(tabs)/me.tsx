import type { Dietary } from "@contracts/dietary";
import { Image } from "expo-image";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { errorMessage } from "@/api/client";
import { useDietary, useUpdateDietary, useUpdateMe } from "@/api/hooks/me";
import { pickAndUploadImage } from "@/api/hooks/uploads";
import { DietaryPicker } from "@/components/DietaryPicker";
import { InviteBanner } from "@/components/InviteBanner";
import { MyPreferences } from "@/components/MyPreferences";
import { ErrorState, LoadingState } from "@/components/States";
import { useToast } from "@/components/ui";
import { Button, Card, Input, SectionHeader } from "@/components/ui";
import { useActiveGroup } from "@/state/ActiveGroupContext";
import { useAuth } from "@/state/AuthContext";
import { colors, fontSize, spacing } from "@/theme";

/** Personal dashboard: my preferences for this household, my diets/allergens, profile, sign out. */
export default function MeScreen() {
  const { activeGroupId } = useActiveGroup();
  const { signOut } = useAuth();
  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <InviteBanner />
      <View style={styles.inner}>
        <Profile />
        {activeGroupId ? <MyPreferences groupId={activeGroupId} /> : null}
        <DietarySection />
        <Button title="Sign out" variant="secondary" style={styles.signOut} onPress={() => void signOut()} />
      </View>
    </ScrollView>
  );
}

function Profile() {
  const { user } = useAuth();
  const update = useUpdateMe();
  const { show: toast } = useToast();
  const [zip, setZip] = useState(user?.zipCode ?? "");
  const [uploading, setUploading] = useState(false);
  if (!user) return null;
  const onError = (e: unknown) => toast(errorMessage(e), { tone: "error" });

  async function changeAvatar() {
    setUploading(true);
    try {
      const key = await pickAndUploadImage("avatar");
      if (key) update.mutate({ avatarKey: key }, { onError });
    } catch (e) {
      onError(e);
    } finally {
      setUploading(false);
    }
  }

  return (
    <Card style={styles.profile}>
      <View style={styles.row}>
        {user.avatarUrl ? (
          <Image source={{ uri: user.avatarUrl }} style={styles.avatar} accessibilityLabel="Your avatar" />
        ) : (
          <View style={[styles.avatar, styles.initials]}>
            <Text style={styles.initialsText}>{user.displayName.slice(0, 1).toUpperCase()}</Text>
          </View>
        )}
        <View style={styles.flex}>
          <Text style={styles.name}>{user.displayName}</Text>
          <Text style={styles.muted}>{user.email}</Text>
        </View>
      </View>
      <Button title="Change photo" variant="ghost" compact loading={uploading} onPress={changeAvatar} />
      <View style={styles.row}>
        <View style={styles.flex}>
          <Input
            label="ZIP code (for price estimates)"
            value={zip}
            onChangeText={(t) => setZip(t.replace(/\D/g, "").slice(0, 5))}
            keyboardType="number-pad"
            maxLength={5}
          />
        </View>
        <Button
          title="Save"
          compact
          style={styles.saveZip}
          disabled={!(zip === "" || /^\d{5}$/.test(zip)) || zip === (user.zipCode ?? "")}
          loading={update.isPending}
          onPress={() => update.mutate({ zipCode: zip || null }, { onSuccess: () => toast("ZIP saved"), onError })}
        />
      </View>
    </Card>
  );
}

function DietarySection() {
  const dietary = useDietary();
  const update = useUpdateDietary();
  const { show: toast } = useToast();
  return (
    <View>
      <SectionHeader title="Dietary" />
      <Card>
        {dietary.isPending ? (
          <LoadingState />
        ) : dietary.isError ? (
          <ErrorState error={dietary.error} onRetry={() => dietary.refetch()} />
        ) : (
          <>
            <DietaryPicker
              value={dietary.data}
              onChange={(v: Dietary) => update.mutate(v, { onError: (e) => toast(errorMessage(e), { tone: "error" }) })}
            />
            <Text style={styles.muted}>Your allergens are flagged on your household&apos;s shopping list.</Text>
          </>
        )}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingBottom: spacing.xxl },
  inner: { padding: spacing.lg, gap: spacing.sm },
  profile: { gap: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  flex: { flex: 1 },
  avatar: { width: 56, height: 56, borderRadius: 28 },
  initials: { backgroundColor: colors.primaryLight, alignItems: "center", justifyContent: "center" },
  initialsText: { color: colors.primaryDark, fontWeight: "800", fontSize: fontSize.xl },
  name: { fontSize: fontSize.lg, fontWeight: "700", color: colors.text },
  muted: { fontSize: fontSize.sm, color: colors.textMuted },
  saveZip: { alignSelf: "flex-end" },
  signOut: { marginTop: spacing.xl },
});
