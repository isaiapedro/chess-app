import React, { useState } from "react";
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  Bell,
  CircleAlert,
  CircleCheck,
  HardDrive,
  Heart,
  LogOut,
  MessageCircle,
  Shield,
  User,
} from "lucide-react-native";
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
import { AppIcon } from "../icons";
import type { Platform } from "../api/types";
import { colors, font, radius, result, spacing, type } from "../theme";
import { AccountScreen } from "./AccountScreen";
import { FeedbackScreen } from "./FeedbackScreen";
import { NotificationsScreen } from "./NotificationsScreen";
import { StorageScreen } from "./StorageScreen";

const DONATE_PLACEHOLDER = "Donation link not configured yet.";
const PRIVACY_PLACEHOLDER = "Privacy & safety settings not configured yet.";

export function ProfileScreen() {
  const auth = useAuth();
  const { refresh } = useFilters();
  const [loginPlatform, setLoginPlatform] = useState<Platform>("chesscom");
  const [chessUsername, setChessUsername] = useState("");
  const [chessEmail, setChessEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showStorage, setShowStorage] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);

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

  if (showAccount) {
    return (
      <AccountScreen
        onBack={() => setShowAccount(false)}
        onDeleted={() => {
          setShowAccount(false);
          setStatus(null);
          setFailed(false);
        }}
      />
    );
  }

  if (showNotifications) {
    return (
      <NotificationsScreen onBack={() => setShowNotifications(false)} />
    );
  }

  if (showStorage) {
    return <StorageScreen onBack={() => setShowStorage(false)} />;
  }

  if (showFeedback) {
    return <FeedbackScreen onBack={() => setShowFeedback(false)} />;
  }

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
            {auth.avatarUrl ? (
              <Image
                source={{ uri: auth.avatarUrl }}
                style={styles.avatarImage}
                accessibilityLabel={`${auth.username} avatar`}
              />
            ) : (
              <Text style={styles.avatarInitial}>
                {(auth.username || "?").slice(0, 1).toUpperCase()}
              </Text>
            )}
          </View>
          <View style={styles.identityText}>
            <Text style={styles.identityName} numberOfLines={1}>
              {auth.username || "Unnamed player"}
            </Text>
            <Text style={styles.identityMeta} numberOfLines={1}>
              {platformLabel}
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
        <SettingsRow
          label="Donate"
          icon={Heart}
          value="Placeholder"
          onPress={() => {
            setFailed(false);
            setStatus(DONATE_PLACEHOLDER);
          }}
        />
      </View>

      <View style={styles.section}>
        <SectionLabel>Settings</SectionLabel>
        <SettingsRow
          label="Account"
          icon={User}
          onPress={() => setShowAccount(true)}
        />
        <Divider />
        <SettingsRow
          label="Notifications"
          icon={Bell}
          onPress={() => setShowNotifications(true)}
        />
        <Divider />
        <SettingsRow
          label="Storage"
          icon={HardDrive}
          onPress={() => setShowStorage(true)}
        />
        <Divider />
        <SettingsRow
          label="Privacy & safety"
          icon={Shield}
          value="Placeholder"
          onPress={() => {
            setFailed(false);
            setStatus(PRIVACY_PLACEHOLDER);
          }}
        />
      </View>

      <View style={styles.section}>
        <SectionLabel>About</SectionLabel>
        <SettingsRow label="Version" value="1.0.0" showChevron={false} />
        <Divider />
        <SettingsRow
          label="Feedback"
          icon={MessageCircle}
          onPress={() => setShowFeedback(true)}
        />
      </View>

      {status ? (
        <View style={styles.statusRow}>
          <AppIcon
            icon={failed ? CircleAlert : CircleCheck}
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

      {auth.isLoggedIn ? (
        <View style={styles.section}>
          <SettingsRow
            label={busy ? "Signing out…" : "Log out"}
            icon={LogOut}
            tone={colors.red}
            onPress={() => void onLogout()}
            showChevron={false}
          />
        </View>
      ) : null}
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
    overflow: "hidden",
    borderWidth: 0.5,
    borderColor: "rgba(255,255,255,0.55)",
  },
  avatarImage: {
    width: 64,
    height: 64,
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
