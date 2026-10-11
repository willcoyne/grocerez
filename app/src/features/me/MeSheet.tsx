/**
 * "Me" as a paper note pinned below the shopping list on the pantry (it replaced the Me tab): my preferences, diet and
 * allergies, profile (photo, ZIP), the room's appearance (theme picker) and sign out. Opens after the camera flies to the note and the paper lifts off its pin,
 * exactly like the List note.
 */
import type { Dietary } from "@contracts/dietary";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import { errorMessage } from "@/api/client";
import { useDietary, useUpdateDietary, useUpdateMe } from "@/api/hooks/me";
import { pickAndUploadImage } from "@/api/hooks/uploads";
import { DietaryPicker } from "@/components/DietaryPicker";
import { InviteBanner } from "@/components/InviteBanner";
import { MyPreferences } from "@/components/MyPreferences";
import { AppText, Avatar, Button, Card, ErrorState, LoadingState, TextField, useToast } from "@/components/ui";
import { makePaperStyles, PAPER_MARGIN_X, PaperSection, PaperSheet } from "@/features/pantry/overlay/PaperSheet";
import { useOverlayStyles } from "@/features/pantry/overlay/palette";
import { AnimationChoice, InterfaceChoice } from "@/features/simple/InterfaceChoice";
import { AppearancePicker } from "@/features/stations/AppearancePicker";
import { useAuth } from "@/state/AuthContext";
import { size, space } from "@/theme";

export type MeSheetProps = { visible: boolean; groupId: string; onClose: () => void };

export function MeSheet({ visible, groupId, onClose }: MeSheetProps) {
  if (!visible) return null;
  return <MeNote groupId={groupId} onClose={onClose} />;
}

function MeNote({ groupId, onClose }: Omit<MeSheetProps, "visible">) {
  const { signOut } = useAuth();
  const router = useRouter();
  const paper = useOverlayStyles(makePaperStyles);
  return (
    <PaperSheet testID="me-note" title="Me" closeLabel="Close my preferences" onClose={onClose}>
      <ScrollView style={paper.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.block}>
          <InviteBanner />
        </View>
        <PaperSection title="What I want from the store" />
        <View style={styles.block}>
          <MyPreferences groupId={groupId} />
        </View>
        <PaperSection title="Diet and allergies" />
        <View style={styles.block}>
          <DietarySection />
        </View>
        <PaperSection title="Interface" />
        <View style={styles.block}>
          <InterfaceChoice />
        </View>
        <PaperSection title="Animations" />
        <View style={styles.block}>
          <AnimationChoice />
        </View>
        <PaperSection title="Appearance" />
        <View style={styles.block}>
          <AppearancePicker />
        </View>
        <PaperSection title="Profile" />
        <View style={styles.block}>
          <Profile />
        </View>
        <PaperSection title="About" />
        <View style={[styles.block, styles.buttons]}>
          <Button
            label="How the Pantry Agent works"
            variant="secondary"
            fullWidth
            onPress={() => {
              onClose();
              router.push("/agent-flow");
            }}
          />
          <Button label="Sign out" variant="secondary" fullWidth onPress={() => void signOut()} />
        </View>
      </ScrollView>
    </PaperSheet>
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
  const zipValid = zip === "" || /^\d{5}$/.test(zip);

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
          <Avatar userId={user.id} name={user.displayName} large />
        )}
        <View style={styles.flex}>
          <AppText variant="bodyL" weight="heavy">
            {user.displayName}
          </AppText>
          <AppText variant="caption" color="muted" numberOfLines={1}>
            {user.email}
          </AppText>
        </View>
        <Button label="Change photo" variant="ghost" size="sm" loading={uploading} onPress={changeAvatar} />
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
          />
        </View>
        <Button
          label="Save"
          variant="secondary"
          disabled={!zipValid || zip === (user.zipCode ?? "")}
          loading={update.isPending}
          onPress={() => update.mutate({ zipCode: zip || null }, { onSuccess: () => toast("ZIP saved"), onError })}
          style={styles.saveZip}
        />
      </View>
    </Card>
  );
}

function DietarySection() {
  const dietary = useDietary();
  const update = useUpdateDietary();
  const { show: toast } = useToast();
  if (dietary.isPending) return <LoadingState />;
  if (dietary.isError) return <ErrorState message={errorMessage(dietary.error)} onRetry={() => void dietary.refetch()} />;
  return (
    <View style={styles.dietary}>
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

const styles = StyleSheet.create({
  content: { paddingBottom: space.xxl },
  block: { paddingLeft: PAPER_MARGIN_X - 4, paddingRight: 16, paddingTop: space.sm, gap: space.sm },
  buttons: { gap: space.sm },
  dietary: { gap: space.sm },
  profile: { gap: space.md },
  row: { flexDirection: "row", alignItems: "center", gap: space.md },
  zipRow: { flexDirection: "row", alignItems: "flex-start", gap: space.sm },
  flex: { flex: 1 },
  avatar: { width: size.avatarLg, height: size.avatarLg, borderRadius: size.avatarLg / 2 },
  saveZip: { marginTop: 25 },
});
