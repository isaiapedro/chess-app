import React, { useEffect } from "react";
import {
  ActivityIndicator,
  StatusBar,
  StyleSheet,
  TurboModuleRegistry,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { NavigationContainer, DarkTheme } from "@react-navigation/native";
import {
  useFonts,
  PlayfairDisplay_600SemiBold,
  PlayfairDisplay_700Bold,
} from "@expo-google-fonts/playfair-display";
import {
  IBMPlexMono_400Regular,
  IBMPlexMono_500Medium,
  IBMPlexMono_700Bold,
} from "@expo-google-fonts/ibm-plex-mono";
import { FilterProvider } from "./src/context/FilterContext";
import { FilterHeader } from "./src/components/FilterHeader";
import { TabNavigator } from "./src/navigation/TabNavigator";
import { StockfishProvider } from "./src/engine/StockfishProvider";
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
    PlayfairDisplay_600SemiBold,
    PlayfairDisplay_700Bold,
    IBMPlexMono_400Regular,
    IBMPlexMono_500Medium,
    IBMPlexMono_700Bold,
  });

  useEffect(() => {
    // #region agent log
    fetch("http://127.0.0.1:7474/ingest/3d67426d-0ccd-41bb-b08a-f7bf8ec78c30", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "6840b8",
      },
      body: JSON.stringify({
        sessionId: "6840b8",
        runId: "pre-fix",
        hypothesisId: "D",
        location: "App.tsx:mount",
        message: "App mounted",
        data: {
          ghAvailable,
          rootIsView: GestureRoot === View,
          fontsLoaded,
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
  }, [fontsLoaded]);

  if (!fontsLoaded) {
    return (
      <View style={styles.boot}>
        <ActivityIndicator color={colors.red} />
      </View>
    );
  }

  return (
    <GestureRoot style={styles.flex}>
      <SafeAreaProvider>
        <FilterProvider>
          <StockfishProvider>
            <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
              <StatusBar barStyle="light-content" />
              <View style={styles.shell}>
                <FilterHeader />
                <NavigationContainer theme={navTheme}>
                  <TabNavigator />
                </NavigationContainer>
              </View>
            </SafeAreaView>
          </StockfishProvider>
        </FilterProvider>
      </SafeAreaProvider>
    </GestureRoot>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  boot: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
  },
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  shell: {
    flex: 1,
  },
});
