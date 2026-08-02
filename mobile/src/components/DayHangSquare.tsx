import React, { useEffect, useMemo, useRef } from "react";
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useFilters } from "../context/FilterContext";
import { useTabSwipe } from "../context/TabSwipeContext";
import { colors, font, spacing } from "../theme";

const HANG_SIZE = 52;
const OVERLAP = 16;
const RECAP_TAB_INDEX = 0;

export function DayHangSquare() {
  const {
    period,
    selectedDay,
    dayCalendarOpen,
    setDayCalendarOpen,
    filterChromeBottom,
  } = useFilters();
  const { activeTabIndex, pageProgress } = useTabSwipe();
  const { width: screenWidth } = useWindowDimensions();
  const baseShift = useRef(new Animated.Value(-(screenWidth / 5) + 4)).current;

  useEffect(() => {
    baseShift.setValue(-(screenWidth / 5) + 4);
  }, [baseShift, screenWidth]);

  useEffect(() => {
    if (activeTabIndex !== RECAP_TAB_INDEX) setDayCalendarOpen(false);
  }, [activeTabIndex, setDayCalendarOpen]);

  const translateX = useMemo(
    () =>
      Animated.add(
        baseShift,
        Animated.multiply(pageProgress, -screenWidth)
      ),
    [baseShift, pageProgress, screenWidth]
  );

  if (period !== "day") return null;
  if (!(filterChromeBottom > 0)) return null;

  const monthLabel = selectedDay
    .toLocaleDateString(undefined, { month: "short" })
    .toUpperCase();

  return (
    <View style={styles.layer} pointerEvents="box-none">
      <Animated.View
        style={[
          styles.hangWrap,
          {
            top: filterChromeBottom - OVERLAP,
            transform: [{ translateX }, { translateY: 12 }, { rotate: "1.5deg" }],
          },
        ]}
        pointerEvents={activeTabIndex === RECAP_TAB_INDEX ? "auto" : "none"}
      >
        <Pressable
          onPress={() => setDayCalendarOpen(!dayCalendarOpen)}
          accessibilityRole="button"
          accessibilityLabel="Toggle day calendar"
        >
          <View style={styles.hangSquare}>
            <View style={styles.hangHeader}>
              <Text style={styles.hangMonth}>{monthLabel}</Text>
            </View>
            <View style={styles.hangBody}>
              <Text style={styles.hangDay}>{selectedDay.getDate()}</Text>
            </View>
          </View>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 100,
    elevation: 100,
  },
  hangWrap: {
    position: "absolute",
    right: spacing.md,
    zIndex: 101,
    elevation: 101,
  },
  hangSquare: {
    width: HANG_SIZE,
    borderWidth: 1,
    borderColor: "#1a1a1a",
    backgroundColor: colors.cream,
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 4,
    shadowOffset: { width: 1, height: 3 },
    elevation: 101,
  },
  hangHeader: {
    backgroundColor: colors.red,
    paddingVertical: 3,
    alignItems: "center",
    justifyContent: "center",
  },
  hangMonth: {
    color: colors.text,
    fontFamily: font.monoBold,
    fontSize: 9,
    letterSpacing: 1,
  },
  hangBody: {
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.cream,
  },
  hangDay: {
    color: "#111111",
    fontFamily: font.display,
    fontSize: 22,
    lineHeight: 24,
  },
});
