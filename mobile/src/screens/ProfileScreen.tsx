import React, { useState } from "react";
import {
  ActivityIndicator,
  InteractionManager,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  BrutalButton,
  Caption,
  Divider,
  DisplayTitle,
  MetaTag,
  SectionLabel,
  SettingsRow,
} from "../components/ui";
import { FadeFromBlank } from "../components/LoadingSkeletons";
import { useAuth } from "../context/AuthContext";
import { useFilters } from "../context/FilterContext";
import { resetBackgroundWork } from "../engine/backgroundWork";
import { cancelActiveGlobalScan } from "../engine/globalAnalysis";
import { resetPrefetchMemory } from "../engine/studyPrefetch";
import { clearAppCache } from "../storage/cache";
import { resetBaselineMemoryCache } from "../data/baselines";
import type { Platform } from "../api/types";
import { colors, font, radius, result, spacing, type } from "../theme";

// Not wired to a backend yet — surfaced as explicit placeholders.
const BUG_REPORT_PLACEHOLDER = "Bug report destination not configured yet.";
const DONATE_PLACEHOLDER = "Donation link not configured yet.";

export function ProfileScreen() {
  const auth = useAuth();
  const { refresh } = useFilters();
  const [loginPlatform, setLoginPlatform] = useState<Platform>("chesscom");
  const [chessUsername, setChessUsername] = useState("");
  const [chessEmail, setChessEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const onClearCache = async () => {
    if (clearing) return;
    setClearing(true);
    setStatus(null);
    setFailed(false);
    try {
      cancelActiveGlobalScan();
      resetPrefetchMemory();
      resetBackgroundWork();
      resetBaselineMemoryCache();
      const removed = await clearAppCache();
      setStatus(
        removed
          ? `Cleared ${removed} cached ${removed === 1 ? "entry" : "entries"}.`
          : "Nothing cached."
      );
      InteractionManager.runAfterInteractions(() => {
        refresh();
      });
    } catch (e) {
      setFailed(true);
      setStatus(e instanceof Error ? e.message : "Failed to clear cache");
    } finally {
      setClearing(false);
    }
  };

  const onChesscomLogin = async () => {
    if (busy) return;
    setBusy(true);
    setStatus(null);
    setFailed(false);
    try {
      await auth.loginChesscom(chessUsername, chessEmail);
      refresh();
      setStatus("Signed in with Chess.com.");
    } catch (e) {
      setFailed(true);
      setStatus(e instanceof Error ? e.message : "Chess.com login failed");
    } finally {
      setBusy(false);
    }
  };

  const onLichessLogin = async () => {
    if (busy) return;
    setBusy(true);
    setStatus(null);
    setFailed(false);
    try {
      await auth.loginLichess();
      refresh();
      setStatus("Signed in with Lichess.");
    } catch (e) {
      setFailed(true);
      setStatus(e instanceof Error ? e.message : "Lichess login failed");
    } finally {
      setBusy(false);
    }
  };

  const onLogout = async () => {
    if (busy) return;
    setBusy(true);
    setStatus(null);
    setFailed(false);
    try {
      await auth.logout();
      refresh();
      setStatus("Signed out.");
    } catch (e) {
      setFailed(true);
      setStatus(e instanceof Error ? e.message : "Logout failed");
    } finally {
      setBusy(false);
    }
  };

  const platformLabel =
    auth.platform === "lichess" ? "Lichess" : "Chess.com";

  return (
    <FadeFromBlank
      contentKey={`profile:${auth.isLoggedIn ? auth.username || "in" : "out"}`}
      ready
      style={styles.fade}
    >
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <DisplayTitle size={30}>Profile</DisplayTitle>

      {auth.isLoggedIn ? (
        <View style={styles.identity}>
          <View style={styles.avatar}>
            <Text style={styles.avatarInitial}>
              {(auth.username || "?").slice(0, 1).toUpperCase()}
            </Text>
          </View>
          <View style={styles.identityText}>
            <Text style={styles.identityName} numberOfLines={1}>
              {auth.username || "Unnamed player"}
            </Text>
            <Text style={styles.identityMeta} numberOfLines={1}>
              {platformLabel}
              {auth.email ? ` · ${auth.email}` : ""}
            </Text>
          </View>
        </View>
      ) : (
        <View style={styles.signInBlock}>
          <SectionLabel>Sign in</SectionLabel>
          <Caption>
            Connect an account to ingest your games on-device.
          </Caption>

          <View style={styles.toggleRow}>
            <MetaTag
              label="Chess.com"
              active={loginPlatform === "chesscom"}
              onPress={() => setLoginPlatform("chesscom")}
            />
            <MetaTag
              label="Lichess"
              active={loginPlatform === "lichess"}
              onPress={() => setLoginPlatform("lichess")}
            />
          </View>

          {loginPlatform === "chesscom" ? (
            <View style={styles.form}>
              <TextInput
                value={chessUsername}
                onChangeText={setChessUsername}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="Chess.com username"
                placeholderTextColor={colors.textDim}
                style={styles.input}
              />
              <TextInput
                value={chessEmail}
                onChangeText={setChessEmail}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                placeholder="Contact email (API user agent)"
                placeholderTextColor={colors.textDim}
                style={styles.input}
              />
              <BrutalButton
                label={busy ? "Signing in…" : "Continue"}
                onPress={() => void onChesscomLogin()}
                disabled={busy}
              />
            </View>
          ) : (
            <View style={styles.form}>
              <Caption>
                Lichess OAuth requests email:read and study:write so the app can
                load your games and add positions to a study.
              </Caption>
              <BrutalButton
                label={busy ? "Opening Lichess…" : "Continue with Lichess"}
                onPress={() => void onLichessLogin()}
                disabled={busy}
              />
            </View>
          )}
          {busy ? (
            <ActivityIndicator color={colors.textMuted} style={styles.spinner} />
          ) : null}
        </View>
      )}

      <View style={styles.section}>
        <SectionLabel>Settings</SectionLabel>
        <SettingsRow
          label={clearing ? "Clearing cache…" : "Clear cached data"}
          icon="trash-outline"
          onPress={() => void onClearCache()}
          showChevron={false}
        />
        <Divider />
        <SettingsRow
          label="Report a bug"
          icon="bug-outline"
          value="Placeholder"
          onPress={() => {
            setFailed(false);
            setStatus(BUG_REPORT_PLACEHOLDER);
          }}
        />
        <Divider />
        <SettingsRow
          label="Donate"
          icon="heart-outline"
          value="Placeholder"
          onPress={() => {
            setFailed(false);
            setStatus(DONATE_PLACEHOLDER);
          }}
        />
        {auth.isLoggedIn ? (
          <>
            <Divider />
            <SettingsRow
              label={busy ? "Signing out…" : "Log out"}
              icon="log-out-outline"
              tone={colors.red}
              onPress={() => void onLogout()}
              showChevron={false}
            />
          </>
        ) : null}
      </View>

      {status ? (
        <View style={styles.statusRow}>
          <Ionicons
            name={failed ? "alert-circle-outline" : "checkmark-circle-outline"}
            size={16}
            color={failed ? result.loss : colors.sage}
          />
          <Text
            style={[
              styles.status,
              { color: failed ? result.loss : colors.sage },
            ]}
          >
            {status}
          </Text>
        </View>
      ) : null}

      <View style={styles.section}>
        <SectionLabel>About</SectionLabel>
        <SettingsRow label="Version" value="Placeholder" showChevron={false} />
        <Divider />
        <SettingsRow label="Terms & privacy" value="Placeholder" />
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
  identity: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    backgroundColor: colors.mutedAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitial: {
    ...type.title,
    color: colors.textSoft,
  },
  identityText: {
    flex: 1,
    minWidth: 0,
  },
  identityName: {
    ...type.heading,
    color: colors.text,
  },
  identityMeta: {
    ...type.caption,
    color: colors.textDim,
    marginTop: 2,
  },
  signInBlock: {
    marginTop: spacing.xl,
    gap: spacing.sm,
  },
  toggleRow: {
    flexDirection: "row",
    gap: spacing.sm,
    flexWrap: "wrap",
    marginTop: spacing.xs,
  },
  form: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  input: {
    borderRadius: radius.pill,
    backgroundColor: colors.muted,
    color: colors.text,
    fontFamily: font.sans,
    fontSize: 15,
    paddingHorizontal: spacing.md,
    paddingVertical: 13,
  },
  spinner: {
    marginTop: spacing.sm,
  },
  section: {
    marginTop: spacing.xl,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: spacing.md,
  },
  status: {
    ...type.caption,
    flex: 1,
  },
});
