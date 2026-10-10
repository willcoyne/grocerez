import DateTimePicker from "@react-native-community/datetimepicker";
import { useState } from "react";
import { Platform, StyleSheet, View } from "react-native";

import { parseCalendarDate, toCalendarDate } from "@/lib/format";
import { spacing } from "@/theme";
import { Button, Input } from "./ui";

/** "Edit date" → native date picker (a YYYY-MM-DD text field on web). Calls onChange with "YYYY-MM-DD". */
export function DateField({
  value,
  onChange,
  label = "Edit date",
  disabled,
}: {
  value: string | null;
  onChange: (ymd: string) => void;
  label?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(value ?? "");

  if (Platform.OS === "web") {
    return (
      <View style={styles.row}>
        <View style={styles.flex}>
          <Input label="Expiration (YYYY-MM-DD)" value={text} onChangeText={setText} placeholder="2026-10-14" />
        </View>
        <Button title="Save" compact disabled={disabled || !/^\d{4}-\d{2}-\d{2}$/.test(text)} onPress={() => onChange(text)} />
      </View>
    );
  }

  return (
    <View>
      <Button title={label} variant="secondary" compact disabled={disabled} onPress={() => setOpen(true)} />
      {open ? (
        <DateTimePicker
          value={value ? parseCalendarDate(value) : new Date()}
          mode="date"
          display={Platform.OS === "ios" ? "inline" : "default"}
          onChange={(event, date) => {
            setOpen(Platform.OS === "ios" && event.type !== "set" ? open : false);
            if (event.type === "set" && date) {
              setOpen(false);
              onChange(toCalendarDate(date));
            }
            if (event.type === "dismissed") setOpen(false);
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm },
  flex: { flex: 1 },
});
