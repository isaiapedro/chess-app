import React, { useEffect, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import type { Platform } from "../api/types";
import { resolveOpponentAvatarUrl } from "../data/opponentAvatar";
import { colors, font } from "../theme";

type Props = {
  platform: Platform;
  username?: string | null;
  size?: number;
};

export function OpponentAvatar({ platform, username, size = 36 }: Props) {
  const [uri, setUri] = useState<string | null>(null);
  const name = String(username || "").trim();
  const initial = (name || "?").slice(0, 1).toUpperCase();

  useEffect(() => {
    let alive = true;
    setUri(null);
    void resolveOpponentAvatarUrl(platform, name).then((next) => {
      if (alive) setUri(next);
    });
    return () => {
      alive = false;
    };
  }, [platform, name]);

  return (
    <View
      style={[
        styles.wrap,
        { width: size, height: size, borderRadius: size / 2 },
      ]}
    >
      {uri ? (
        <Image
          source={{ uri }}
          style={{ width: size, height: size, borderRadius: size / 2 }}
        />
      ) : (
        <Text style={[styles.initial, { fontSize: Math.round(size * 0.42) }]}>
          {initial}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  initial: {
    fontFamily: font.sansBold,
    color: colors.cream,
  },
});
