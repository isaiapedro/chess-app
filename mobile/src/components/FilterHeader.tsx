import React, { useMemo } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import type { Period } from "../api/types";
import { useFilters } from "../context/FilterContext";
import { SelectField } from "./ui";
import { colors, font, spacing, withAlpha } from "../theme";

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

const DOW = ["M", "T", "W", "T", "F", "S", "S"] as const;
const HANG_SIZE = 52;

function startOfWeek(d: Date): Date {
  const copy = new Date(d);
  const weekday = copy.getDay();
  copy.setDate(copy.getDate() + (weekday === 0 ? -6 : 1 - weekday));
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function addDays(d: Date, n: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}

function weekDays(anchor: Date): Date[] {
  const start = startOfWeek(anchor);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

function isoKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function FilterHeader() {
  const {
    period,
    setPeriod,
    selectedDay,
    setSelectedDay,
    speed,
    setSpeed,
    dayCalendarOpen,
    setDayCalendarOpen,
    setFilterChromeBottom,
  } = useFilters();

  const { width: screenWidth } = useWindowDimensions();
  const hangClearance = HANG_SIZE + screenWidth / 5 - 4 + 10;
  const days = useMemo(() => weekDays(selectedDay), [selectedDay]);
  const today = useMemo(() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
  }, []);

  return (
    <View style={styles.wrap}>
      <View
        style={styles.selectRow}
        onLayout={(event) => {
          const { y, height } = event.nativeEvent.layout;
          setFilterChromeBottom(spacing.sm + y + height);
        }}
      >
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

      {period === "day" && dayCalendarOpen ? (
        <View style={[styles.weekRow, { paddingRight: hangClearance }]}>
          <Pressable
            style={styles.navBtn}
            onPress={() => setSelectedDay(addDays(selectedDay, -7))}
            hitSlop={8}
          >
            <Text style={styles.navText}>‹</Text>
          </Pressable>
          {days.map((day, index) => {
            const selected = sameDay(day, selectedDay);
            const isFuture = day.getTime() > today.getTime();
            return (
              <Pressable
                key={isoKey(day)}
                style={[
                  styles.weekCell,
                  selected && styles.weekCellSelected,
                  isFuture && styles.weekCellDisabled,
                ]}
                disabled={isFuture}
                onPress={() => {
                  setSelectedDay(day);
                  setDayCalendarOpen(false);
                }}
              >
                <Text
                  style={[
                    styles.weekDow,
                    selected && styles.weekDowSelected,
                    isFuture && styles.weekTextDisabled,
                  ]}
                >
                  {DOW[index]}
                </Text>
                <Text
                  style={[
                    styles.weekDayNum,
                    selected && styles.weekDayNumSelected,
                    isFuture && styles.weekTextDisabled,
                  ]}
                >
                  {day.getDate()}
                </Text>
              </Pressable>
            );
          })}
          <Pressable
            style={styles.navBtn}
            onPress={() => {
              const next = addDays(selectedDay, 7);
              if (startOfWeek(next).getTime() <= startOfWeek(today).getTime()) {
                setSelectedDay(
                  next.getTime() > today.getTime() ? today : next
                );
              }
            }}
            hitSlop={8}
          >
            <Text style={styles.navText}>›</Text>
          </Pressable>
        </View>
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
    paddingBottom: spacing.sm,
    gap: spacing.sm,
    zIndex: 2,
    overflow: "visible",
  },
  selectRow: {
    flexDirection: "row",
    gap: 10,
  },
  weekRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 1,
  },
  navBtn: {
    width: 18,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
  },
  navText: {
    color: colors.cream,
    fontFamily: font.monoBold,
    fontSize: 18,
    lineHeight: 20,
  },
  weekCell: {
    flex: 1,
    minWidth: 0,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 3,
  },
  weekCellSelected: {
    backgroundColor: withAlpha(colors.red, 0.22),
  },
  weekCellDisabled: {
    opacity: 0.35,
  },
  weekDow: {
    color: colors.textDim,
    fontFamily: font.mono,
    fontSize: 8,
    letterSpacing: 0.3,
    lineHeight: 10,
  },
  weekDowSelected: {
    color: colors.cream,
  },
  weekDayNum: {
    color: colors.textSoft,
    fontFamily: font.monoBold,
    fontSize: 11,
    lineHeight: 13,
  },
  weekDayNumSelected: {
    color: colors.text,
  },
  weekTextDisabled: {
    color: colors.textDisabled,
  },
});
