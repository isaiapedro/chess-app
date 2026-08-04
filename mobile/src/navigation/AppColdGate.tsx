import React, { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { ChessPieceLoader } from "../components/LoadingSkeletons";
import { useAnalytics } from "../context/AnalyticsContext";
import { useAuth } from "../context/AuthContext";
import { resetBackgroundWork } from "../engine/backgroundWork";
import { colors } from "../theme";

const COLD_BOOT_MAX_MS = 2500;

export function AppColdGate({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const { gamesLoading, recap } = useAnalytics();
  const [coldDone, setColdDone] = useState(false);

  useEffect(() => {
    resetBackgroundWork();
  }, []);

  useEffect(() => {
    if (coldDone) return;
    if (!auth.ready) return;
    if (!auth.isLoggedIn) {
      setColdDone(true);
      return;
    }
    if (recap != null || !gamesLoading) {
      setColdDone(true);
      return;
    }
    const t = setTimeout(() => setColdDone(true), COLD_BOOT_MAX_MS);
    return () => clearTimeout(t);
  }, [auth.ready, auth.isLoggedIn, gamesLoading, recap, coldDone]);

  const blocking = !coldDone;

  return (
    <View style={styles.root}>
      {blocking ? (
        <View style={styles.overlay} pointerEvents="auto">
          <ChessPieceLoader fullscreen />
        </View>
      ) : (
        children
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.bg,
    zIndex: 100,
  },
});
