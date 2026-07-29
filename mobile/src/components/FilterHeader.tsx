import React, { useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useFilters } from "../context/FilterContext";
import type { DatePreset, Platform, Timeframe } from "../api/types";
import { colors, spacing } from "../theme";

const DATE_PRESETS: { key: DatePreset; label: string }[] = [
  { key: "all", label: "All" },
  { key: "year", label: "Year" },
  { key: "month", label: "Month" },
  { key: "week", label: "Week" },
  { key: "day", label: "Day" },
  { key: "custom", label: "Custom" },
];

const PLATFORMS: Platform[] = ["chesscom", "lichess"];
const TIMEFRAMES: Timeframe[] = ["1 month", "6 months", "1 year"];
const SPEEDS = [null, "bullet", "blitz", "rapid", "classical"] as const;
const COLORS = [null, "white", "black"] as const;

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, active && styles.chipActive]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function FilterHeader() {
  const {
    username,
    setUsername,
    platform,
    setPlatform,
    timeframe,
    setTimeframe,
    datePreset,
    setDatePreset,
    customFrom,
    setCustomFrom,
    customTo,
    setCustomTo,
    speed,
    setSpeed,
    color,
    setColor,
    refresh,
  } = useFilters();

  const [showFrom, setShowFrom] = useState(false);
  const [showTo, setShowTo] = useState(false);

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Chess Wrapped</Text>
      <View style={styles.row}>
        <TextInput
          style={styles.input}
          value={username}
          onChangeText={setUsername}
          placeholder="Username"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Pressable style={styles.refreshBtn} onPress={refresh}>
          <Text style={styles.refreshText}>Load</Text>
        </Pressable>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
      >
        {PLATFORMS.map((p) => (
          <Chip
            key={p}
            label={p}
            active={platform === p}
            onPress={() => setPlatform(p)}
          />
        ))}
        {TIMEFRAMES.map((t) => (
          <Chip
            key={t}
            label={t}
            active={timeframe === t}
            onPress={() => setTimeframe(t)}
          />
        ))}
      </ScrollView>

      <Text style={styles.sectionLabel}>Date filter</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
      >
        {DATE_PRESETS.map((p) => (
          <Chip
            key={p.key}
            label={p.label}
            active={datePreset === p.key}
            onPress={() => setDatePreset(p.key)}
          />
        ))}
      </ScrollView>

      {datePreset === "custom" && (
        <View style={styles.customRow}>
          <Pressable
            style={styles.dateBtn}
            onPress={() => setShowFrom(true)}
          >
            <Text style={styles.dateBtnText}>
              From: {customFrom ? customFrom.toISOString().slice(0, 10) : "pick"}
            </Text>
          </Pressable>
          <Pressable style={styles.dateBtn} onPress={() => setShowTo(true)}>
            <Text style={styles.dateBtnText}>
              To: {customTo ? customTo.toISOString().slice(0, 10) : "pick"}
            </Text>
          </Pressable>
        </View>
      )}

      {showFrom && (
        <DateTimePicker
          value={customFrom || new Date()}
          mode="date"
          onChange={(_, date) => {
            setShowFrom(false);
            if (date) setCustomFrom(date);
          }}
        />
      )}
      {showTo && (
        <DateTimePicker
          value={customTo || new Date()}
          mode="date"
          onChange={(_, date) => {
            setShowTo(false);
            if (date) setCustomTo(date);
          }}
        />
      )}

      <Text style={styles.sectionLabel}>Extras</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
      >
        {SPEEDS.map((s) => (
          <Chip
            key={s ?? "all-speed"}
            label={s ?? "All speeds"}
            active={speed === s}
            onPress={() => setSpeed(s)}
          />
        ))}
        {COLORS.map((c) => (
          <Chip
            key={c ?? "all-color"}
            label={c ?? "All colors"}
            active={color === c}
            onPress={() => setColor(c)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  title: {
    color: colors.accent,
    fontSize: 20,
    fontWeight: "700",
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  input: {
    flex: 1,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    color: colors.text,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  refreshBtn: {
    backgroundColor: colors.accentDim,
    borderRadius: 8,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
  },
  refreshText: {
    color: colors.accent,
    fontWeight: "700",
  },
  sectionLabel: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  chipRow: {
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: colors.bg,
  },
  chipActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentDim,
  },
  chipText: {
    color: colors.textMuted,
    fontSize: 13,
  },
  chipTextActive: {
    color: colors.accent,
    fontWeight: "600",
  },
  customRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  dateBtn: {
    flex: 1,
    backgroundColor: colors.bg,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
  },
  dateBtnText: {
    color: colors.text,
    fontSize: 13,
  },
});
