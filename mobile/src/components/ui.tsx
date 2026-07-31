import React, { useState } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TextStyle,
  View,
  ViewStyle,
} from "react-native";
import { colors, font, spacing, withAlpha } from "../theme";

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
    <View style={[styles.edgeCard, lifted && styles.edgeCardLifted, style]}>
      {children}
    </View>
  );
}

export function BrutalButton({
  label,
  onPress,
  disabled,
  ghost,
  style,
}: {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  ghost?: boolean;
  style?: ViewStyle;
}) {
  return (
    <View style={[styles.brutalOuter, disabled && styles.brutalDisabledOuter, style]}>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        style={({ pressed }) => [
          styles.brutalInner,
          ghost && styles.brutalGhost,
          disabled && styles.brutalDisabled,
          pressed && !disabled && styles.brutalPressed,
        ]}
      >
        <Text style={[styles.brutalText, ghost && styles.brutalGhostText, disabled && styles.brutalDisabledText]}>
          {label}
        </Text>
      </Pressable>
    </View>
  );
}

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
      style={[
        styles.pill,
        {
          borderColor: withAlpha(color, 0.45),
          backgroundColor: withAlpha(color, 0.12),
        },
        style,
      ]}
    >
      <Text style={[styles.pillText, { color }, textStyle]}>{children}</Text>
    </View>
  );
}

export function MetaTag({
  label,
  active,
  onPress,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.metaTag, active && styles.metaTagActive]}
    >
      <Text style={[styles.metaTagText, active && styles.metaTagTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

export function PaperCard({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.paperWrap}>
      <View style={styles.paperCard}>
        <View style={styles.tape} />
        {title ? <Text style={styles.paperTitle}>{title}</Text> : null}
        <Text style={styles.paperBody}>{children}</Text>
      </View>
    </View>
  );
}

export function SearchField({
  value,
  onChangeText,
  placeholder = "Search...",
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <View style={styles.searchWrap}>
      <Text style={styles.searchIcon}>⌕</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textDim}
        style={styles.searchInput}
      />
      {value ? (
        <Pressable onPress={() => onChangeText("")} hitSlop={8}>
          <Text style={styles.searchClear}>✕</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

type SelectOption = { value: string; label: string };

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
      <Text style={styles.selectLabel}>{label}</Text>
      <Pressable style={styles.selectField} onPress={() => setOpen(true)}>
        <Text style={styles.selectValue} numberOfLines={1}>
          {current}
        </Text>
        <Text style={styles.selectCaret}>▾</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setOpen(false)}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{label}</Text>
            {options.map((option) => {
              const active = option.value === value;
              return (
                <Pressable
                  key={option.value}
                  style={[styles.modalOption, active && styles.modalOptionActive]}
                  onPress={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                >
                  <Text style={[styles.modalOptionText, active && styles.modalOptionTextActive]}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

export function Eyebrow({ children, color = colors.red }: { children: React.ReactNode; color?: string }) {
  return <Text style={[styles.eyebrow, { color }]}>{children}</Text>;
}

export function DisplayTitle({ children, size = 34 }: { children: React.ReactNode; size?: number }) {
  return <Text style={[styles.displayTitle, { fontSize: size }]}>{children}</Text>;
}

const styles = StyleSheet.create({
  edgeCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 0,
    padding: spacing.md,
  },
  edgeCardLifted: {
    shadowColor: "#000",
    shadowOpacity: 0.6,
    shadowRadius: 0,
    shadowOffset: { width: 6, height: 6 },
    elevation: 4,
  },
  brutalOuter: {
    backgroundColor: colors.shadowGray,
    paddingBottom: 5,
    paddingRight: 0,
  },
  brutalDisabledOuter: {
    backgroundColor: colors.mutedAlt,
  },
  brutalInner: {
    backgroundColor: colors.red,
    borderColor: colors.text,
    borderWidth: 2,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: "center",
  },
  brutalGhost: {
    backgroundColor: colors.bg,
    borderColor: colors.border,
  },
  brutalDisabled: {
    backgroundColor: colors.muted,
    borderColor: colors.border,
  },
  brutalPressed: {
    transform: [{ translateY: 2 }],
  },
  brutalText: {
    color: colors.text,
    fontFamily: font.monoBold,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  brutalGhostText: {
    color: colors.textSoft,
  },
  brutalDisabledText: {
    color: colors.textDisabled,
  },
  pill: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 9,
    paddingVertical: 3,
    alignSelf: "flex-start",
  },
  pillText: {
    fontFamily: font.monoBold,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  metaTag: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  metaTagActive: {
    backgroundColor: colors.textSoft,
    borderColor: colors.textSoft,
  },
  metaTagText: {
    fontFamily: font.mono,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: colors.textMuted,
  },
  metaTagTextActive: {
    color: "#111111",
  },
  sectionLabel: {
    fontFamily: font.mono,
    fontSize: 11,
    letterSpacing: 2,
    textTransform: "uppercase",
    color: colors.textDim,
    marginBottom: spacing.sm,
  },
  paperWrap: {
    paddingTop: 18,
    paddingHorizontal: 4,
  },
  paperCard: {
    backgroundColor: colors.cream,
    paddingTop: 22,
    paddingHorizontal: 18,
    paddingBottom: 18,
    transform: [{ rotate: "-1deg" }],
    shadowColor: "#000",
    shadowOpacity: 0.45,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  tape: {
    position: "absolute",
    top: -14,
    alignSelf: "center",
    width: 120,
    height: 28,
    backgroundColor: "rgba(255,255,255,0.45)",
    transform: [{ rotate: "-3deg" }],
  },
  paperTitle: {
    fontFamily: font.monoMedium,
    fontSize: 12,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    color: "#6b6355",
    marginBottom: 6,
  },
  paperBody: {
    fontFamily: font.displayMedium,
    fontSize: 16,
    lineHeight: 24,
    color: "#1c1a16",
  },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(240,240,240,0.08)",
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 12,
    minHeight: 44,
  },
  searchIcon: {
    color: colors.textDim,
    marginRight: 8,
    fontSize: 14,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
    paddingVertical: 10,
  },
  searchClear: {
    color: colors.textDim,
    fontSize: 14,
    paddingLeft: 8,
  },
  selectGroup: {
    flex: 1,
    minWidth: 0,
  },
  selectLabel: {
    fontFamily: font.mono,
    fontSize: 10,
    letterSpacing: 2,
    textTransform: "uppercase",
    color: colors.textDim,
    marginBottom: 5,
  },
  selectField: {
    minHeight: 42,
    borderWidth: 1,
    borderColor: colors.text,
    backgroundColor: colors.charcoal,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    shadowColor: colors.shadowGray,
    shadowOpacity: 1,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  selectValue: {
    flex: 1,
    color: colors.text,
    fontFamily: font.monoBold,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginRight: 8,
  },
  selectCaret: {
    color: colors.red,
    fontSize: 12,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "center",
    padding: spacing.lg,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    padding: spacing.md,
  },
  modalTitle: {
    fontFamily: font.monoBold,
    fontSize: 11,
    letterSpacing: 2,
    textTransform: "uppercase",
    color: colors.textDim,
    marginBottom: spacing.sm,
  },
  modalOption: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalOptionActive: {
    backgroundColor: withAlpha(colors.red, 0.12),
  },
  modalOptionText: {
    fontFamily: font.monoMedium,
    fontSize: 13,
    color: colors.textSoft,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  modalOptionTextActive: {
    color: colors.red,
  },
  eyebrow: {
    fontFamily: font.monoBold,
    fontSize: 12,
    letterSpacing: 2.2,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  displayTitle: {
    fontFamily: font.display,
    color: colors.text,
    lineHeight: 40,
  },
});
