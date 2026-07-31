import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { DisplayTitle } from "../components/ui";
import { colors, font, spacing } from "../theme";

export function ProfileScreen() {
  return (
    <View style={styles.container}>
      <DisplayTitle size={30}>Profile</DisplayTitle>
      <Text style={styles.muted}>Coming soon.</Text>
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
    color: colors.textDim,
    fontFamily: font.sans,
    fontSize: 14,
  },
});
