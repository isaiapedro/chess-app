import React, { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import {
  ChessPieceLoader,
  RecapSkeleton,
} from "../components/LoadingSkeletons";
import { useAnalytics } from "../context/AnalyticsContext";
import { useAuth } from "../context/AuthContext";
import { resetBackgroundWork } from "../engine/backgroundWork";
import { colors } from "../theme";

const COLD_PAWN_MS = 600;

type ColdPhase = "pawn" | "skeleton" | "done";

export function AppColdGate({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const { gamesLoading, recap } = useAnalytics();
  const [phase, setPhase] = useState<ColdPhase>("pawn");

  const monthReady =
    auth.ready &&
    (!auth.isLoggedIn || recap != null || !gamesLoading);

  useEffect(() => {
    resetBackgroundWork();
  }, []);

  useEffect(() => {
    if (!monthReady) return;
    setPhase("done");
  }, [monthReady]);

  useEffect(() => {
    if (phase !== "pawn") return;
    const t = setTimeout(() => {
      setPhase((prev) => (prev === "pawn" ? "skeleton" : prev));
    }, COLD_PAWN_MS);
    return () => clearTimeout(t);
  }, [phase]);

  if (phase === "done") {
    return <View style={styles.root}>{children}</View>;
  }

  return (
    <View style={styles.root}>
      {phase === "pawn" ? (
        <View style={styles.overlay} pointerEvents="auto">
          <ChessPieceLoader fullscreen />
        </View>
      ) : (
        <View style={styles.overlay} pointerEvents="auto">
          <RecapSkeleton />
        </View>
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
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.bg,
    zIndex: 100,
  },
});
