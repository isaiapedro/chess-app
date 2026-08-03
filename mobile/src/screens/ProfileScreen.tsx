import React, { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { BrutalButton, DisplayTitle, MetaTag } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useFilters } from "../context/FilterContext";
import { resetPrefetchMemory } from "../engine/studyPrefetch";
import { clearAppCache } from "../storage/cache";
import type { Platform } from "../api/types";
import { colors, font, result, spacing } from "../theme";

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
      resetPrefetchMemory();
      const removed = await clearAppCache();
      refresh();
      setStatus(
        removed
          ? `Cleared ${removed} cached ${removed === 1 ? "entry" : "entries"} (incl. Stockfish vault).`
          : "Nothing cached."
      );
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

  return (
    <View style={styles.container}>
      <DisplayTitle size={30}>Profile</DisplayTitle>
      <Text style={styles.muted}>Account, local data & tools</Text>

      {auth.isLoggedIn ? (
        <View style={styles.card}>
          <Text style={styles.label}>Signed in</Text>
          <Text style={styles.value}>{auth.username}</Text>
          <Text style={styles.meta}>
            {auth.platform === "lichess" ? "Lichess" : "Chess.com"}
            {auth.email ? ` · ${auth.email}` : ""}
          </Text>
          <BrutalButton
            label={busy ? "Working…" : "Log out"}
            onPress={() => void onLogout()}
            disabled={busy}
            ghost
            style={styles.button}
          />
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.label}>Sign in</Text>
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
              <Text style={styles.fieldLabel}>Username</Text>
              <TextInput
                value={chessUsername}
                onChangeText={setChessUsername}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="chess.com username"
                placeholderTextColor={colors.textDim}
                style={styles.input}
              />
              <Text style={styles.fieldLabel}>Email</Text>
              <TextInput
                value={chessEmail}
                onChangeText={setChessEmail}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                placeholder="contact email for API User-Agent"
                placeholderTextColor={colors.textDim}
                style={styles.input}
              />
              <BrutalButton
                label={busy ? "Signing in…" : "Save Chess.com account"}
                onPress={() => void onChesscomLogin()}
                disabled={busy}
                style={styles.button}
              />
            </View>
          ) : (
            <View style={styles.form}>
              <Text style={styles.help}>
                Lichess OAuth requests email:read and study:write so the app can
                load your games and add positions to a study.
              </Text>
              <BrutalButton
                label={busy ? "Opening Lichess…" : "Continue with Lichess"}
                onPress={() => void onLichessLogin()}
                disabled={busy}
                style={styles.button}
              />
            </View>
          )}
          {busy ? (
            <ActivityIndicator color={colors.cream} style={{ marginTop: spacing.sm }} />
          ) : null}
        </View>
      )}

      <BrutalButton
        label={clearing ? "Clearing…" : "Clear cache"}
        onPress={() => void onClearCache()}
        disabled={clearing}
        style={styles.button}
      />
      {status ? (
        <Text
          style={[styles.status, failed ? styles.statusErr : styles.statusOk]}
        >
          {status}
        </Text>
      ) : null}
      {!auth.isLoggedIn ? (
        <Pressable onPress={() => undefined}>
          <Text style={styles.footerHint}>
            Sign in to ingest games on-device. Explorer / masters still use the API.
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    padding: spacing.md,
  },
  muted: {
    marginTop: spacing.md,
    marginBottom: spacing.md,
    color: colors.textDim,
    fontFamily: font.sans,
    fontSize: 14,
  },
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  label: {
    color: colors.textMuted,
    fontFamily: font.mono,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  value: {
    color: colors.text,
    fontFamily: font.displayMedium,
    fontSize: 22,
  },
  meta: {
    color: colors.textDim,
    fontFamily: font.mono,
    fontSize: 12,
  },
  toggleRow: {
    flexDirection: "row",
    gap: spacing.sm,
    flexWrap: "wrap",
  },
  form: {
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  fieldLabel: {
    color: colors.textMuted,
    fontFamily: font.mono,
    fontSize: 11,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.charcoal,
    color: colors.text,
    fontFamily: font.mono,
    fontSize: 14,
    paddingHorizontal: spacing.sm,
    paddingVertical: 10,
  },
  help: {
    color: colors.textDim,
    fontFamily: font.sans,
    fontSize: 13,
    lineHeight: 18,
  },
  button: {
    alignSelf: "stretch",
    marginTop: spacing.xs,
  },
  status: {
    marginTop: spacing.sm,
    fontFamily: font.mono,
    fontSize: 12,
  },
  statusOk: {
    color: colors.sage,
  },
  statusErr: {
    color: result.loss,
  },
  footerHint: {
    marginTop: spacing.md,
    color: colors.textDim,
    fontFamily: font.sans,
    fontSize: 12,
    lineHeight: 17,
  },
});
