import React, { useEffect } from "react";
import {
  StatusBar,
  StyleSheet,
  TurboModuleRegistry,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { NavigationContainer, DarkTheme } from "@react-navigation/native";
import {
  useFonts,
  Inter_300Light,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";
import { AuthProvider } from "./src/context/AuthContext";
import { FilterProvider } from "./src/context/FilterContext";
import { AnalyticsProvider } from "./src/context/AnalyticsContext";
import { ScanLogProvider } from "./src/context/ScanLogContext";
import { InsightsNavProvider } from "./src/context/InsightsNavContext";
import { TabSwipeProvider } from "./src/context/TabSwipeContext";
import { DayHangSquare } from "./src/components/DayHangSquare";
import { FilterHeader } from "./src/components/FilterHeader";
import { BootSkeleton } from "./src/components/LoadingSkeletons";
import { TabNavigator } from "./src/navigation/TabNavigator";
import { StockfishProvider } from "./src/engine/StockfishProvider";
import { StudyPrefetch } from "./src/engine/StudyPrefetch";
import { DEBUG_DISABLE_BACKGROUND_JOBS } from "./src/engine/debugFlags";
import { colors } from "./src/theme";

const ghAvailable =
  TurboModuleRegistry.get("RNGestureHandlerModule") != null;
let GestureRoot: React.ComponentType<Record<string, unknown>> = View as React.ComponentType<
  Record<string, unknown>
>;
if (ghAvailable) {
  try {
    GestureRoot =
      require("react-native-gesture-handler").GestureHandlerRootView;
  } catch {
    GestureRoot = View as React.ComponentType<Record<string, unknown>>;
  }
}

const navTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.bg,
    card: colors.surface,
    text: colors.text,
    border: colors.border,
    primary: colors.accent,
  },
};

export default function App() {
  const [fontsLoaded] = useFonts({
    Inter_300Light,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (!fontsLoaded || !DEBUG_DISABLE_BACKGROUND_JOBS) return;
    // #region agent log
    console.log("[bg-off] background jobs disabled via DEBUG_DISABLE_BACKGROUND_JOBS");
    fetch("http://127.0.0.1:7677/ingest/217f9228-6275-432a-b240-b52166a932e5", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "6d2375",
      },
      body: JSON.stringify({
        sessionId: "6d2375",
        runId: "bg-off",
        hypothesisId: "H-bg",
        location: "App.tsx",
        message: "background jobs disabled",
        data: { StudyPrefetch: false, prefetch: false, recapFetchGames: false },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
  }, [fontsLoaded]);

  if (!fontsLoaded) {
    return <BootSkeleton />;
  }

  return (
    <GestureRoot style={styles.flex}>
      <SafeAreaProvider>
        <AuthProvider>
          <FilterProvider>
            <ScanLogProvider>
              <AnalyticsProvider>
              <TabSwipeProvider>
                <InsightsNavProvider>
                  <StockfishProvider>
                    {!DEBUG_DISABLE_BACKGROUND_JOBS ? <StudyPrefetch /> : null}
                    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
                      <StatusBar barStyle="light-content" />
                      <View style={styles.shell}>
                        <FilterHeader />
                        <View style={styles.navLayer}>
                          <NavigationContainer theme={navTheme}>
                            <TabNavigator />
                          </NavigationContainer>
                        </View>
                        <DayHangSquare />
                      </View>
                    </SafeAreaView>
                  </StockfishProvider>
                </InsightsNavProvider>
              </TabSwipeProvider>
              </AnalyticsProvider>
            </ScanLogProvider>
          </FilterProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureRoot>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  shell: {
    flex: 1,
    overflow: "visible",
    zIndex: 1,
  },
  navLayer: {
    flex: 1,
    zIndex: 1,
  },
});
