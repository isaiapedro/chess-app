import React from "react";
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
import { BootSkeleton } from "./src/components/LoadingSkeletons";
import { TabNavigator } from "./src/navigation/TabNavigator";
import { StockfishProvider } from "./src/engine/StockfishProvider";
import { StudyPrefetch } from "./src/engine/StudyPrefetch";
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

  if (!fontsLoaded) {
    return <BootSkeleton />;
  }

  return (
    <GestureRoot style={styles.flex}>
      <SafeAreaProvider>
        <FilterProvider>
          <StockfishProvider>
            <StudyPrefetch />
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
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  shell: {
    flex: 1,
  },
});
