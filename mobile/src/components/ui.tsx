import React, { useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TextStyle,
  View,
  ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, font, radius, spacing, type, withAlpha } from "../theme";

/* ---------------------------------------------------------------- surfaces */

/**
 * Soft rounded surface. Replaces the old hard-edged "edge card" — same name so
 * existing call sites keep working.
 */
export function EdgeCard({
  children,
  style,
  lifted = false,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
  lifted?: boolean;
}) {
  return (
    <View style={[styles.card, lifted && styles.cardLifted, style]}>
      {children}
    </View>
  );
}

/** Card with no fill — content grouped by spacing alone. */
export function BareGroup({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  return <View style={[styles.bareGroup, style]}>{children}</View>;
}

export function Divider({ style }: { style?: ViewStyle }) {
  return <View style={[styles.divider, style]} />;
}

/* ----------------------------------------------------------------- buttons */

/**
 * Minimal action. `ghost` renders text-only (no container at all); default is a
 * single rounded pill with no nested boxes or offset shadow.
 */
export function BrutalButton({
  label,
  onPress,
  disabled,
  ghost,
  tone,
  style,
}: {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  ghost?: boolean;
  tone?: string;
  style?: ViewStyle;
}) {
  const accent = tone || colors.accent;
  if (ghost) {
    return (
      <Pressable
        onPress={onPress}
        disabled={disabled}
        hitSlop={8}
        style={({ pressed }) => [
          styles.textButton,
          pressed && !disabled && styles.pressedSoft,
          style,
        ]}
      >
        <Text
          style={[
            styles.textButtonLabel,
            { color: accent },
            disabled && styles.disabledText,
          ]}
        >
          {label}
        </Text>
      </Pressable>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.pillButton,
        { backgroundColor: accent },
        disabled && styles.pillButtonDisabled,
        pressed && !disabled && styles.pressedSoft,
        style,
      ]}
    >
      <Text style={[styles.pillButtonLabel, disabled && styles.disabledText]}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Icon-only tap target. No frame, no background. */
export function IconButton({
  name,
  onPress,
  size = 22,
  color = colors.textSoft,
  accessibilityLabel,
  style,
}: {
  name: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
  size?: number;
  color?: string;
  accessibilityLabel?: string;
  style?: ViewStyle;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        styles.iconButton,
        pressed && styles.pressedSoft,
        style,
      ]}
    >
      <Ionicons name={name} size={size} color={color} />
    </Pressable>
  );
}

/** Text + arrow back affordance. */
export function BackLink({
  label,
  onPress,
  style,
}: {
  label: string;
  onPress?: () => void;
  style?: ViewStyle;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      style={({ pressed }) => [
        styles.backLink,
        pressed && styles.pressedSoft,
        style,
      ]}
    >
      <Ionicons name="chevron-back" size={18} color={colors.textMuted} />
      <Text style={styles.backLinkLabel}>{label}</Text>
    </Pressable>
  );
}

/* ------------------------------------------------------------------- chips */

export function Pill({
  children,
  color = colors.textMuted,
  style,
  textStyle,
}: {
  children: React.ReactNode;
  color?: string;
  style?: ViewStyle;
  textStyle?: TextStyle;
}) {
  return (
    <View
      style={[styles.pill, { backgroundColor: withAlpha(color, 0.16) }, style]}
    >
      <Text style={[styles.pillText, { color }, textStyle]}>{children}</Text>
    </View>
  );
}

/** Selectable rounded chip (filter row). Filled when active, soft when not. */
export function MetaTag({
  label,
  active,
  onPress,
  tone,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  tone?: string;
}) {
  const accent = tone || colors.text;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        active && { backgroundColor: accent },
        pressed && styles.pressedSoft,
      ]}
    >
      <Text
        style={[
          styles.chipText,
          active && { color: accent === colors.text ? "#000000" : colors.text },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/* ---------------------------------------------------------------- headings */

/** Small muted kicker above a title. */
export function Eyebrow({
  children,
  color = colors.textDim,
}: {
  children: React.ReactNode;
  color?: string;
}) {
  return <Text style={[styles.eyebrow, { color }]}>{children}</Text>;
}

/** Page-level title. */
export function DisplayTitle({
  children,
  size = 30,
  style,
}: {
  children: React.ReactNode;
  size?: number;
  style?: TextStyle;
}) {
  return (
    <Text
      style={[
        styles.displayTitle,
        { fontSize: size, lineHeight: Math.round(size * 1.16) },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

/** Section name — a plain name, no box, no all-caps tracking. */
export function SectionLabel({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: TextStyle;
}) {
  return <Text style={[styles.sectionLabel, style]}>{children}</Text>;
}

/** Secondary caption under a heading or value. */
export function Caption({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: TextStyle;
}) {
  return <Text style={[styles.caption, style]}>{children}</Text>;
}

/**
 * Tab row where the active item is marked by a short underline only.
 */
export function SectionTabs({
  items,
  activeKey,
  onSelect,
  style,
}: {
  items: { key: string; label: string }[];
  activeKey: string;
  onSelect: (key: string) => void;
  style?: ViewStyle;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={[styles.tabsRow, style]}
    >
      {items.map((item) => {
        const active = item.key === activeKey;
        return (
          <Pressable
            key={item.key}
            onPress={() => onSelect(item.key)}
            style={styles.tabItem}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
          >
            <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>
              {item.label}
            </Text>
            <View
              style={[styles.tabUnderline, active && styles.tabUnderlineActive]}
            />
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/* ------------------------------------------------------------------- data */

/** Number + name, no container. */
export function StatTile({
  label,
  value,
  caption,
  tone = colors.text,
  style,
}: {
  label: string;
  value: string | number;
  caption?: string;
  tone?: string;
  style?: ViewStyle;
}) {
  return (
    <View style={[styles.statTile, style]}>
      <Text style={[styles.statValue, { color: tone }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
      {caption ? <Text style={styles.statCaption}>{caption}</Text> : null}
    </View>
  );
}

/** Thin rounded progress track. */
export function Meter({
  ratio,
  tone = colors.text,
  markerRatio,
  style,
}: {
  ratio: number;
  tone?: string;
  markerRatio?: number;
  style?: ViewStyle;
}) {
  const clamped = Math.max(0, Math.min(1, ratio));
  return (
    <View style={[styles.meterTrack, style]}>
      <View
        style={[
          styles.meterFill,
          { width: `${clamped * 100}%`, backgroundColor: tone },
        ]}
      />
      {markerRatio != null ? (
        <View
          style={[
            styles.meterMarker,
            { left: `${Math.max(0, Math.min(1, markerRatio)) * 100}%` },
          ]}
        />
      ) : null}
    </View>
  );
}

/** Explicit stand-in for data we don't have yet. */
export function Placeholder({
  label = "No data yet",
  style,
}: {
  label?: string;
  style?: ViewStyle;
}) {
  return (
    <View style={[styles.placeholder, style]}>
      <Text style={styles.placeholderText}>{label}</Text>
    </View>
  );
}

/** Quiet note card, replaces the taped-paper card. */
export function PaperCard({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.noteCard}>
      {title ? <Text style={styles.noteTitle}>{title}</Text> : null}
      <Text style={styles.noteBody}>{children}</Text>
    </View>
  );
}

/* ------------------------------------------------------------------ inputs */

export function SearchField({
  value,
  onChangeText,
  placeholder = "Search",
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <View style={styles.searchWrap}>
      <Ionicons name="search" size={17} color={colors.textDim} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textDim}
        style={styles.searchInput}
      />
      {value ? (
        <Pressable onPress={() => onChangeText("")} hitSlop={10}>
          <Ionicons name="close" size={17} color={colors.textDim} />
        </Pressable>
      ) : null}
    </View>
  );
}

type SelectOption = { value: string; label: string };

/** Borderless select: value + caret, opens a rounded sheet. */
export function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value)?.label ?? value;

  return (
    <View style={styles.selectGroup}>
      <Pressable
        style={({ pressed }) => [
          styles.selectField,
          pressed && styles.pressedSoft,
        ]}
        onPress={() => setOpen(true)}
        accessibilityLabel={label}
      >
        <Text style={styles.selectValue} numberOfLines={1}>
          {current}
        </Text>
        <Ionicons name="chevron-down" size={14} color={colors.textDim} />
      </Pressable>
      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setOpen(false)}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{label}</Text>
            {options.map((option) => {
              const active = option.value === value;
              return (
                <Pressable
                  key={option.value}
                  style={styles.modalOption}
                  onPress={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                >
                  <Text
                    style={[
                      styles.modalOptionText,
                      active && styles.modalOptionTextActive,
                    ]}
                  >
                    {option.label}
                  </Text>
                  {active ? (
                    <Ionicons name="checkmark" size={18} color={colors.text} />
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

/** Settings-style row: name, optional value, chevron. No box. */
export function SettingsRow({
  label,
  value,
  icon,
  tone = colors.text,
  onPress,
  showChevron = true,
}: {
  label: string;
  value?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  tone?: string;
  onPress?: () => void;
  showChevron?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressedSoft]}
      accessibilityRole="button"
    >
      {icon ? (
        <Ionicons name={icon} size={20} color={tone} style={styles.rowIcon} />
      ) : null}
      <Text style={[styles.rowLabel, { color: tone }]}>{label}</Text>
      {value ? <Text style={styles.rowValue}>{value}</Text> : null}
      {showChevron ? (
        <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  /* surfaces */
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  cardLifted: {
    backgroundColor: colors.surfaceRaised,
  },
  bareGroup: {
    gap: spacing.sm,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },

  /* buttons */
  pillButton: {
    borderRadius: radius.pill,
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  pillButtonDisabled: {
    backgroundColor: colors.muted,
  },
  pillButtonLabel: {
    ...type.label,
    fontFamily: font.sansBold,
    fontSize: 15,
    color: colors.text,
  },
  textButton: {
    paddingVertical: 10,
    alignItems: "center",
  },
  textButtonLabel: {
    ...type.label,
    fontFamily: font.sansBold,
    fontSize: 15,
  },
  disabledText: {
    color: colors.textDisabled,
  },
  pressedSoft: {
    opacity: 0.55,
  },
  iconButton: {
    alignItems: "center",
    justifyContent: "center",
  },
  backLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    marginBottom: spacing.sm,
    alignSelf: "flex-start",
  },
  backLinkLabel: {
    ...type.label,
    color: colors.textMuted,
  },

  /* chips */
  pill: {
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: "flex-start",
  },
  pillText: {
    ...type.micro,
    fontFamily: font.sansMedium,
  },
  chip: {
    backgroundColor: colors.mutedAlt,
    borderRadius: radius.pill,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  chipText: {
    ...type.label,
    color: colors.textSoft,
  },

  /* headings */
  eyebrow: {
    ...type.caption,
    fontFamily: font.sansMedium,
    marginBottom: 6,
  },
  displayTitle: {
    fontFamily: font.sansBold,
    color: colors.text,
    letterSpacing: -0.8,
  },
  sectionLabel: {
    ...type.heading,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  caption: {
    ...type.caption,
    color: colors.textDim,
  },
  tabsRow: {
    gap: spacing.lg,
    paddingRight: spacing.md,
  },
  tabItem: {
    alignItems: "center",
    gap: 6,
  },
  tabLabel: {
    ...type.subheading,
    fontFamily: font.sansMedium,
    color: colors.textDim,
  },
  tabLabelActive: {
    color: colors.text,
    fontFamily: font.sansBold,
  },
  tabUnderline: {
    height: 2,
    width: 22,
    borderRadius: radius.pill,
    backgroundColor: "transparent",
  },
  tabUnderlineActive: {
    backgroundColor: colors.text,
  },

  /* data */
  statTile: {
    minWidth: 0,
  },
  statValue: {
    ...type.numberMd,
  },
  statLabel: {
    ...type.label,
    color: colors.textMuted,
    marginTop: 2,
  },
  statCaption: {
    ...type.caption,
    color: colors.textDim,
    marginTop: 4,
  },
  meterTrack: {
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: withAlpha("#ffffff", 0.08),
    overflow: "visible",
    position: "relative",
  },
  meterFill: {
    height: 6,
    borderRadius: radius.pill,
  },
  meterMarker: {
    position: "absolute",
    top: -2,
    width: 2,
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.rim,
    marginLeft: -1,
  },
  placeholder: {
    borderRadius: radius.md,
    backgroundColor: withAlpha("#ffffff", 0.03),
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
    alignItems: "center",
  },
  placeholderText: {
    ...type.caption,
    color: colors.textDim,
  },
  noteCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 6,
  },
  noteTitle: {
    ...type.subheading,
    fontFamily: font.sansBold,
    color: colors.text,
  },
  noteBody: {
    ...type.body,
    color: colors.textMuted,
  },

  /* inputs */
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.muted,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    minHeight: 46,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontFamily: font.sans,
    fontSize: 15,
    paddingVertical: 10,
  },
  selectGroup: {
    flex: 1,
    minWidth: 0,
  },
  selectField: {
    minHeight: 38,
    borderRadius: radius.pill,
    backgroundColor: colors.muted,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
  },
  selectValue: {
    flex: 1,
    color: colors.textSoft,
    fontFamily: font.sansMedium,
    fontSize: 14,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  modalCard: {
    backgroundColor: colors.surfaceRaised,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
  },
  modalTitle: {
    ...type.caption,
    color: colors.textDim,
    marginBottom: spacing.sm,
  },
  modalOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
  },
  modalOptionText: {
    ...type.body,
    fontFamily: font.sansMedium,
    color: colors.textMuted,
  },
  modalOptionTextActive: {
    color: colors.text,
  },

  /* rows */
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: 15,
  },
  rowIcon: {
    width: 24,
  },
  rowLabel: {
    ...type.body,
    fontFamily: font.sansMedium,
    flex: 1,
  },
  rowValue: {
    ...type.caption,
    color: colors.textDim,
  },
});
