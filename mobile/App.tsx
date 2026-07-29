import React from "react";
import { StatusBar, StyleSheet, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { NavigationContainer, DarkTheme } from "@react-navigation/native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { FilterProvider } from "./src/context/FilterContext";
import { FilterHeader } from "./src/components/FilterHeader";
import { TabNavigator } from "./src/navigation/TabNavigator";
import { colors } from "./src/theme";

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
  return (
    <GestureHandlerRootView style={styles.flex}>
      <SafeAreaProvider>
        <FilterProvider>
          <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
            <StatusBar barStyle="light-content" />
            <View style={styles.shell}>
              <FilterHeader />
              <NavigationContainer theme={navTheme}>
                <TabNavigator />
              </NavigationContainer>
            </View>
          </SafeAreaView>
        </FilterProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
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
