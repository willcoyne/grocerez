/**
 * Me station (SPEC.md round 3: chalkboard + apron on the left wall). Today's Me tab content in a station sheet:
 * my preferences for the active household, diet & allergies, profile (photo, ZIP), Appearance (theme picker), sign out.
 * Reuses the app components (MyPreferences, DietaryPicker) and hooks; all rules (lists, allergen flags) stay on the server.
 */
import type { User } from "@contracts/auth";
import type { Dietary } from "@contracts/dietary";
import { Image } from "expo-image";
import { Camera, LogOut } from "lucide-react-native";
import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { errorMessage } from "@/api/client";
import { useDietary, useUpdateDietary, useUpdateMe } from "@/api/hooks/me";
import { pickAndUploadImage } from "@/api/hooks/uploads";
import { DietaryPicker } from "@/components/DietaryPicker";
import { MyPreferences } from "@/components/MyPreferences";
import { AppText, Avatar, Button, DashedEmpty, ErrorState, LoadingState, TextField, useToast } from "@/components/ui";
import { useActiveGroup } from "@/state/ActiveGroupContext";
import { useAuth } from "@/state/AuthContext";
import { size, space } from "@/theme";

import { AppearancePicker } from "./AppearancePicker";
import { StationSection, ThemedButton } from "./parts";
import { StationSheet } from "./StationSheet";
import { useThemeUi } from "./theme";

export type MeSheetProps = { visible: boolean; onClose: () => void };

export function MeSheet({ visible, onClose }: MeSheetProps) {
  const { user, signOut } = useAuth();
  const { activeGroupId, activeGroup } = useActiveGroup();

  return (
    <StationSheet
      visible={visible}
      onClose={onClose}
      title={user?.displayName ?? "Me"}
      subtitle={user?.email}
      headerLeft={user ? <MeAvatar user={user} /> : null}
      testID="me-sheet"
    >
      <StationSection title="What I want from the store" subtitle={activeGroup ? `In ${activeGroup.name}` : undefined}>
        {activeGroupId ? (
          <MyPreferences groupId={activeGroupId} />
        ) : (
          <DashedEmpty>Join or create a household to add the things you want kept in stock.</DashedEmpty>
        )}
      </StationSection>

      <StationSection title="Diet & allergies">
        <DietarySection />
      </StationSection>

      <StationSection title="Profile">
        <ProfileSection />
      </StationSection>

      <StationSection title="Appearance" subtitle="Pick a look for the whole room" bare>
        <AppearancePicker />
      </StationSection>

      <ThemedButton
        label="Sign out"
        variant="secondary"
        icon={LogOut}
        testID="me-sign-out"
        onPress={() => {
          onClose();
          void signOut();
        }}
      />
    </StationSheet>
  );
}

/** Photo (or initial) in a theme-coloured ring. Decorative: the header text names the user. */
function MeAvatar({ user }: { user: User }) {
  const ui = useThemeUi();
  return (
    <View
      style={[styles.avatarRing, { borderColor: ui.buttonRing, borderRadius: ui.pixelBorders ? 0 : 28 }]}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      {user.avatarUrl ? (
        <Image source={{ uri: user.avatarUrl }} style={styles.avatar} accessibilityIgnoresInvertColors />
      ) : (
        <Avatar userId={user.id} name={user.displayName} large />
      )}
    </View>
  );
}

/** Same flow as the Me tab: optimistic PUT /me/dietary; the server re-flags every list. */
function DietarySection() {
  const dietary = useDietary();
  const update = useUpdateDietary();
  const { show: toast } = useToast();
  if (dietary.isPending) return <LoadingState testID="me-dietary-loading" />;
  if (dietary.isError)
    return <ErrorState message={errorMessage(dietary.error)} onRetry={() => void dietary.refetch()} testID="me-dietary-error" />;
  return (
    <View style={styles.gap}>
      <DietaryPicker
        value={dietary.data}
        onChange={(v: Dietary) => update.mutate(v, { onError: (e) => toast(errorMessage(e), { tone: "error" }) })}
      />
      <AppText variant="caption" color="muted">
        Your allergies are flagged on the household&apos;s shopping list, with your name.
      </AppText>
    </View>
  );
}

/** Photo upload (S3 presign → PATCH /me {avatarKey}) and ZIP for price estimates. */
function ProfileSection() {
  const { user } = useAuth();
  const update = useUpdateMe();
  const { show: toast } = useToast();
  const [zip, setZip] = useState(user?.zipCode ?? "");
  const [uploading, setUploading] = useState(false);
  if (!user) return null;
  const onError = (e: unknown) => toast(errorMessage(e), { tone: "error" });
  const zipValid = zip === "" || /^\d{5}$/.test(zip);

  async function changePhoto() {
    setUploading(true);
    try {
      const key = await pickAndUploadImage("avatar");
      if (key) update.mutate({ avatarKey: key }, { onSuccess: () => toast("Photo updated"), onError });
    } catch (e) {
      onError(e);
    } finally {
      setUploading(false);
    }
  }

  return (
    <View style={styles.gap}>
      <View style={styles.row}>
        {user.avatarUrl ? (
          <Image source={{ uri: user.avatarUrl }} style={styles.avatar} accessibilityLabel="Your photo" />
        ) : (
          <Avatar userId={user.id} name={user.displayName} large />
        )}
        <View style={styles.flex}>
          <AppText weight="bold">Profile photo</AppText>
          <AppText variant="caption" color="muted">
            Shown to your household
          </AppText>
        </View>
        <ThemedButton
          label="Change"
          accessibilityLabel="Change profile photo"
          variant="secondary"
          icon={Camera}
          loading={uploading}
          onPress={() => void changePhoto()}
          testID="me-change-photo"
        />
      </View>
      <View style={styles.zipRow}>
        <View style={styles.flex}>
          <TextField
            label="ZIP code (for price estimates)"
            value={zip}
            onChangeText={(t) => setZip(t.replace(/\D/g, "").slice(0, 5))}
            keyboardType="number-pad"
            placeholder="64105"
            error={zipValid ? null : "Enter a 5-digit ZIP code"}
            testID="me-zip"
          />
        </View>
        <Button
          label="Save"
          accessibilityLabel="Save ZIP code"
          variant="secondary"
          disabled={!zipValid || zip === (user.zipCode ?? "")}
          loading={update.isPending}
          onPress={() => update.mutate({ zipCode: zip || null }, { onSuccess: () => toast("ZIP saved"), onError })}
          style={styles.saveZip}
          testID="me-zip-save"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: space.sm },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, flexWrap: "wrap" },
  zipRow: { flexDirection: "row", alignItems: "flex-start", gap: space.sm },
  flex: { flex: 1, minWidth: 120 },
  avatarRing: { borderWidth: 3, padding: 2 },
  avatar: { width: size.avatarLg, height: size.avatarLg, borderRadius: size.avatarLg / 2 },
  saveZip: { marginTop: 25 },
});
