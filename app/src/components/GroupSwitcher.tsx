import { Check } from "lucide-react-native";
import { type ReactNode, useState } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";

import { AppText, ScreenHeader } from "@/components/ui";
import { plural } from "@/lib/format";
import { useActiveGroup } from "@/state/ActiveGroupContext";
import { color, radius, size, space } from "@/theme";

/**
 * Tab screen header (DESIGN.md §3 ScreenHeader) bound to the active household.
 * When the user is in several households the "{group} · n members" line opens a switcher.
 */
export function TabHeader({ title, right }: { title: string; right?: ReactNode }) {
  const { activeGroup, groups, setActiveGroupId } = useActiveGroup();
  const [open, setOpen] = useState(false);
  const several = groups.length > 1;

  return (
    <>
      <ScreenHeader
        groupName={activeGroup?.name}
        memberCount={activeGroup?.memberCount}
        title={title}
        right={right}
        onGroupPress={several ? () => setOpen(true) : undefined}
        groupHint={several ? "Switch" : undefined}
      />
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} accessibilityLabel="Close household list">
          <View style={styles.sheet}>
            <AppText variant="micro" color="muted">
              Switch household
            </AppText>
            {groups.map((g) => {
              const selected = g.id === activeGroup?.id;
              return (
                <Pressable
                  key={g.id}
                  accessibilityRole="button"
                  accessibilityLabel={g.name}
                  accessibilityState={{ selected }}
                  style={[styles.option, selected && styles.optionOn]}
                  onPress={() => {
                    setActiveGroupId(g.id);
                    setOpen(false);
                  }}
                >
                  <View style={styles.flex}>
                    <AppText variant="bodyL" weight="heavy">
                      {g.name}
                    </AppText>
                    <AppText variant="caption" color="muted">
                      {plural(g.memberCount, "member")}
                    </AppText>
                  </View>
                  {selected ? <Check size={20} color={color.primary} strokeWidth={3} /> : null}
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: color.overlay, paddingTop: 100, padding: space.screenX },
  sheet: { backgroundColor: color.surface, borderRadius: radius.cardLg, padding: space.lg, gap: space.sm },
  option: {
    minHeight: size.hit,
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: color.border,
  },
  optionOn: { borderColor: color.primary },
  flex: { flex: 1 },
});
