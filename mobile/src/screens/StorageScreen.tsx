import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  InteractionManager,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { reloadAppAsync } from "expo";
import { Paths } from "expo-file-system";
import { Trash2 } from "lucide-react-native";
import {
  BackLink,
  BrutalButton,
  Caption,
  DisplayTitle,
  Divider,
  SectionLabel,
  SettingsRow,
} from "../components/ui";
import { FadeFromBlank } from "../components/LoadingSkeletons";
import { useFilters } from "../context/FilterContext";
import { resetBackgroundWork } from "../engine/backgroundWork";
import { cancelActiveGlobalScan } from "../engine/globalAnalysis";
import { resetPrefetchMemory } from "../engine/studyPrefetch";
import { resetBaselineMemoryCache } from "../data/baselines";
import {
  clearAppCache,
  estimateAppCacheBytes,
} from "../storage/cache";
import { colors, radius, result, spacing, type } from "../theme";

const WIFI_ONLY_KEY = "@chess-wrapped:prefs:wifi-only";

type Props = {
  onBack: () => void;
};

type DiskSnapshot = {
  total: number;
  free: number;
  app: number;
};

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 ? 0 : value >= 10 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

function directoryBytes(dir: { size: number | null }): number {
  try {
    const size = dir.size;
    return typeof size === "number" && size > 0 ? size : 0;
  } catch {
    return 0;
  }
}

async function measureAppBytes(): Promise<number> {
  const files =
    directoryBytes(Paths.document) + directoryBytes(Paths.cache);
  const asyncStore = await estimateAppCacheBytes();
  return files + asyncStore;
}

async function readDiskSnapshot(): Promise<DiskSnapshot> {
  let total = 0;
  let free = 0;
  try {
    total = Number(Paths.totalDiskSpace) || 0;
    free = Number(Paths.availableDiskSpace) || 0;
  } catch {
    total = 0;
    free = 0;
  }
  const app = await measureAppBytes();
  return { total, free, app };
}

export function StorageScreen({ onBack }: Props) {
  const { refresh } = useFilters();
  const [disk, setDisk] = useState<DiskSnapshot | null>(null);
  const [wifiOnly, setWifiOnly] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [cleared, setCleared] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const refreshDisk = useCallback(async () => {
    const next = await readDiskSnapshot();
    setDisk(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const raw = await AsyncStorage.getItem(WIFI_ONLY_KEY);
        if (!cancelled && raw != null) {
          setWifiOnly(raw === "1" || raw === "true");
        }
      } catch {
        /* keep default */
      }
      if (!cancelled) await refreshDisk();
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshDisk]);

  const persistWifiOnly = (next: boolean) => {
    setWifiOnly(next);
    void AsyncStorage.setItem(WIFI_ONLY_KEY, next ? "1" : "0");
  };

  const onWifiOnlyChange = (next: boolean) => {
    if (wifiOnly && !next) {
      Alert.alert(
        "Allow cellular downloads?",
        "Downloads may use mobile data when Wi-Fi is unavailable.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Allow cellular",
            style: "destructive",
            onPress: () => persistWifiOnly(false),
          },
        ]
      );
      return;
    }
    persistWifiOnly(next);
  };

  const runClearDownloads = async () => {
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
      setCleared(true);
      await refreshDisk();
      InteractionManager.runAfterInteractions(() => {
        refresh();
      });
    } catch (e) {
      setFailed(true);
      setStatus(e instanceof Error ? e.message : "Failed to clear downloads");
    } finally {
      setClearing(false);
    }
  };

  const onClearDownloads = () => {
    if (clearing) return;
    Alert.alert(
      "Clear downloads?",
      "This deletes cached games and analysis on this device. You can download them again later.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: () => {
            void runClearDownloads();
          },
        },
      ]
    );
  };

  const onRestartApp = () => {
    void reloadAppAsync("Storage cleared");
  };

  const total = disk?.total ?? 0;
  const free = disk?.free ?? 0;
  const app = disk?.app ?? 0;
  const other = Math.max(0, total - free - app);
  const appRatio = total > 0 ? Math.min(1, app / total) : 0;
  const otherRatio = total > 0 ? Math.min(1 - appRatio, other / total) : 0;
  const used = Math.max(0, total - free);

  return (
    <FadeFromBlank contentKey="storage" ready style={styles.fade}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <BackLink label="Profile" onPress={onBack} style={styles.back} />
        <DisplayTitle size={30}>Storage</DisplayTitle>

        <View style={styles.section}>
          <SectionLabel>iPhone storage</SectionLabel>
          <View style={styles.barTrack}>
            {appRatio > 0 ? (
              <View
                style={[styles.barSeg, styles.barApp, { flex: appRatio }]}
              />
            ) : null}
            {otherRatio > 0 ? (
              <View
                style={[styles.barSeg, styles.barOther, { flex: otherRatio }]}
              />
            ) : null}
            <View
              style={[
                styles.barSeg,
                styles.barFree,
                { flex: Math.max(0.001, 1 - appRatio - otherRatio) },
              ]}
            />
          </View>
          <View style={styles.legend}>
            <View style={styles.legendItem}>
              <View style={[styles.swatch, { backgroundColor: colors.sage }]} />
              <Text style={styles.legendText}>App {formatBytes(app)}</Text>
            </View>
            <View style={styles.legendItem}>
              <View
                style={[styles.swatch, { backgroundColor: colors.mutedAlt }]}
              />
              <Text style={styles.legendText}>Other {formatBytes(other)}</Text>
            </View>
          </View>
          <Caption>
            {disk
              ? `${formatBytes(used)} used of ${formatBytes(total)}`
              : "Measuring…"}
          </Caption>
        </View>

        <View style={styles.section}>
          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>Download over Wi-Fi only</Text>
            <Switch
              value={wifiOnly}
              onValueChange={onWifiOnlyChange}
              trackColor={{
                false: colors.mutedAlt,
                true: colors.sage,
              }}
              thumbColor={colors.text}
              ios_backgroundColor={colors.mutedAlt}
              accessibilityLabel="Download over Wi-Fi only"
            />
          </View>
          <Divider />
          <SettingsRow
            label={clearing ? "Clearing…" : "Clear downloads"}
            icon={Trash2}
            tone={colors.red}
            onPress={onClearDownloads}
            showChevron={false}
          />
          {status ? (
            <Text
              style={[
                styles.status,
                { color: failed ? result.loss : colors.sage },
              ]}
            >
              {status}
            </Text>
          ) : null}
        </View>

        {cleared && !failed ? (
          <View style={styles.restartBlock}>
            <BrutalButton label="Restart app" onPress={onRestartApp} />
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
  back: {
    marginBottom: spacing.sm,
  },
  section: {
    marginTop: spacing.xl,
    gap: spacing.sm,
  },
  barTrack: {
    flexDirection: "row",
    height: 14,
    borderRadius: radius.pill,
    overflow: "hidden",
    backgroundColor: colors.muted,
    marginTop: spacing.xs,
  },
  barSeg: {
    height: "100%",
  },
  barApp: {
    backgroundColor: colors.sage,
  },
  barOther: {
    backgroundColor: colors.mutedAlt,
  },
  barFree: {
    backgroundColor: colors.muted,
  },
  legend: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  swatch: {
    width: 10,
    height: 10,
    borderRadius: radius.pill,
  },
  legendText: {
    ...type.caption,
    color: colors.textMuted,
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    gap: spacing.md,
  },
  toggleLabel: {
    ...type.body,
    color: colors.text,
    flex: 1,
  },
  status: {
    ...type.caption,
  },
  restartBlock: {
    marginTop: spacing.xxl,
  },
});
