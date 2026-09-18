import React, { useState } from "react";
import {
  Alert,
  InteractionManager,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Mail, Trash2 } from "lucide-react-native";
import {
  BackLink,
  DisplayTitle,
  Divider,
  SettingsRow,
} from "../components/ui";
import { FadeFromBlank } from "../components/LoadingSkeletons";
import { useAuth } from "../context/AuthContext";
import { useFilters } from "../context/FilterContext";
import { resetBackgroundWork } from "../engine/backgroundWork";
import { cancelActiveGlobalScan } from "../engine/globalAnalysis";
import { resetPrefetchMemory } from "../engine/studyPrefetch";
import { resetBaselineMemoryCache } from "../data/baselines";
import { clearAppCache } from "../storage/cache";
import { colors, spacing, type } from "../theme";

type Props = {
  onBack: () => void;
  onDeleted: () => void;
};

export function AccountScreen({ onBack, onDeleted }: Props) {
  const auth = useAuth();
  const { refresh } = useFilters();
  const [busy, setBusy] = useState(false);

  const onDeleteAccount = () => {
    if (busy) return;
    Alert.alert(
      "Delete account",
      "This removes your local account data and cache. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void (async () => {
              setBusy(true);
              try {
                cancelActiveGlobalScan();
                resetPrefetchMemory();
                resetBackgroundWork();
                resetBaselineMemoryCache();
                await clearAppCache();
                await auth.logout();
                InteractionManager.runAfterInteractions(() => {
                  refresh();
                });
                onDeleted();
              } catch {
                setBusy(false);
                Alert.alert(
                  "Delete failed",
                  "Could not delete account. Try again."
                );
              }
            })();
          },
        },
      ]
    );
  };

  return (
    <FadeFromBlank contentKey="account" ready style={styles.fade}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <BackLink label="Profile" onPress={onBack} style={styles.back} />
        <DisplayTitle size={30}>Account</DisplayTitle>

        <View style={styles.section}>
          <SettingsRow
            label="E-mail"
            icon={Mail}
            value={auth.email || "—"}
            showChevron={false}
          />
          <Divider />
          <SettingsRow
            label={busy ? "Deleting…" : "Delete account"}
            icon={Trash2}
            tone={colors.red}
            onPress={onDeleteAccount}
            showChevron={false}
          />
          {busy ? (
            <Text style={styles.busyHint}>Removing local account data…</Text>
          ) : null}
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
  busyHint: {
    ...type.caption,
    color: colors.textDim,
  },
});
