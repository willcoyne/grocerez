import { useRouter } from "expo-router";
import { ScrollView, StyleSheet } from "react-native";

import { MyInvitesList } from "@/components/MyInvitesList";
import { spacing } from "@/theme";

/** My pending invites (also the target of the deep link grocerez://invites; no code in the link). */
export default function InvitesScreen() {
  const router = useRouter();
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <MyInvitesList
        onAccepted={() => {
          if (router.canDismiss()) router.dismissAll();
          router.replace("/");
        }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.xl, gap: spacing.lg, maxWidth: 560, width: "100%", alignSelf: "center" },
});
