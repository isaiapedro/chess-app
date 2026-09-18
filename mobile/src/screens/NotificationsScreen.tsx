import React, { useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import {
  BackLink,
  DisplayTitle,
  Divider,
} from "../components/ui";
import { FadeFromBlank } from "../components/LoadingSkeletons";
import { colors, spacing, type } from "../theme";

type Props = {
  onBack: () => void;
};

type NotifKey = "dailyPuzzles" | "monthlyReviews" | "appUpdates";

const ROWS: { key: NotifKey; label: string }[] = [
  { key: "dailyPuzzles", label: "Daily Puzzles" },
  { key: "monthlyReviews", label: "Monthly Reviews" },
  { key: "appUpdates", label: "App Updates" },
];

export function NotificationsScreen({ onBack }: Props) {
  const [prefs, setPrefs] = useState<Record<NotifKey, boolean>>({
    dailyPuzzles: true,
    monthlyReviews: true,
    appUpdates: true,
  });

  const toggle = (key: NotifKey) => {
    setPrefs((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <FadeFromBlank contentKey="notifications" ready style={styles.fade}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <BackLink label="Profile" onPress={onBack} style={styles.back} />
        <DisplayTitle size={30}>Notifications</DisplayTitle>

        <View style={styles.section}>
          {ROWS.map((row, index) => (
            <View key={row.key}>
              {index > 0 ? <Divider /> : null}
              <View style={styles.row}>
                <Text style={styles.rowLabel}>{row.label}</Text>
                <Switch
                  value={prefs[row.key]}
                  onValueChange={() => toggle(row.key)}
                  trackColor={{
                    false: colors.mutedAlt,
                    true: colors.sage,
                  }}
                  thumbColor={colors.text}
                  ios_backgroundColor={colors.mutedAlt}
                  accessibilityLabel={row.label}
                />
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </FadeFromBlank>
  );
}

const styles = StyleSheet.create({
  fade: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scroll: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: 120,
  },
  back: {
    marginBottom: spacing.sm,
  },
  section: {
    marginTop: spacing.xl,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    gap: spacing.md,
  },
  rowLabel: {
    ...type.body,
    color: colors.text,
    flex: 1,
  },
});
