import React, { useState } from "react";
import {
  Platform as RNPlatform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import type { Period } from "../api/types";
import { useFilters } from "../context/FilterContext";
import { SelectField } from "./ui";
import { colors, font, spacing } from "../theme";

const PERIODS: { value: Period; label: string }[] = [
  { value: "all", label: "All Time" },
  { value: "year", label: "Year" },
  { value: "month", label: "Month" },
  { value: "week", label: "Week" },
  { value: "day", label: "Day" },
];

const SPEEDS = [
  { value: "", label: "All Formats" },
  { value: "bullet", label: "♟ Bullet" },
  { value: "blitz", label: "♝ Blitz" },
  { value: "rapid", label: "♞ Rapid" },
  { value: "classical", label: "♔ Classical" },
];

function formatDay(date: Date): string {
  return date.toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function FilterHeader() {
  const {
    period,
    setPeriod,
    selectedDay,
    setSelectedDay,
    speed,
    setSpeed,
  } = useFilters();

  const [picking, setPicking] = useState(false);

  return (
    <View style={styles.wrap}>
      <View style={styles.selectRow}>
        <SelectField
          label="Period"
          value={period}
          options={PERIODS}
          onChange={(v) => setPeriod(v as Period)}
        />
        <SelectField
          label="Time Format"
          value={speed || ""}
          options={SPEEDS}
          onChange={(v) => setSpeed(v || null)}
        />
      </View>

      {period === "day" ? (
        <Pressable style={styles.dateBtn} onPress={() => setPicking(true)}>
          <Text style={styles.dateText}>{formatDay(selectedDay)}</Text>
        </Pressable>
      ) : null}

      {picking ? (
        <DateTimePicker
          value={selectedDay}
          mode="date"
          maximumDate={new Date()}
          display={RNPlatform.OS === "ios" ? "inline" : "calendar"}
          onChange={(event, date) => {
            if (RNPlatform.OS !== "ios") setPicking(false);
            if (event.type === "dismissed") return;
            if (date) setSelectedDay(date);
          }}
        />
      ) : null}

      {picking && RNPlatform.OS === "ios" ? (
        <Pressable style={styles.doneBtn} onPress={() => setPicking(false)}>
          <Text style={styles.doneText}>Done</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: "rgba(0,0,0,0.96)",
    borderBottomWidth: 1,
    borderBottomColor: colors.rim,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  selectRow: {
    flexDirection: "row",
    gap: 10,
  },
  dateBtn: {
    borderWidth: 1,
    borderColor: "#000000",
    backgroundColor: colors.cream,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  dateText: {
    color: "#111111",
    fontFamily: font.monoBold,
    fontSize: 11,
  },
  doneBtn: {
    backgroundColor: colors.red,
    borderWidth: 2,
    borderColor: colors.text,
    paddingVertical: 10,
  },
  doneText: {
    color: colors.text,
    fontFamily: font.monoBold,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: "uppercase",
    textAlign: "center",
  },
});
