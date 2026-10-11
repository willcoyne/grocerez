/** Light-switch station (SPEC.md round 3): the theme picker on its own. Also embedded in MeSheet. */
import { Lightbulb } from "lucide-react-native";

import { AppearancePicker } from "./AppearancePicker";
import { HeaderIcon, ThemedText } from "./parts";
import { StationSheet } from "./StationSheet";

export type AppearanceSheetProps = { visible: boolean; onClose: () => void };

export function AppearanceSheet({ visible, onClose }: AppearanceSheetProps) {
  return (
    <StationSheet
      visible={visible}
      onClose={onClose}
      title="Appearance"
      subtitle="Pick a look for the whole room"
      headerLeft={<HeaderIcon icon={Lightbulb} />}
      testID="appearance-sheet"
    >
      <ThemedText muted>The pantry, the store and these panels change together. Your choice is saved on this device.</ThemedText>
      <AppearancePicker />
    </StationSheet>
  );
}
