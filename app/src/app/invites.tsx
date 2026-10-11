import { useRouter } from "expo-router";
import { ScrollView, StyleSheet } from "react-native";

import { MyInvitesList } from "@/components/MyInvitesList";
import { SectionLabel } from "@/components/ui";
import { color, space } from "@/theme";

/** My pending invites (also the target of the deep link grocerez://invites; no code in the link). */
export default function InvitesScreen() {
  const router = useRouter();
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <SectionLabel>Invites for you</SectionLabel>
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
  screen: { flex: 1, backgroundColor: color.bg },
  container: { padding: space.screenX, gap: space.md, maxWidth: 560, width: "100%", alignSelf: "center" },
});
