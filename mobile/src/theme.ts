import type { TextStyle } from "react-native";

export const colors = {
  bg: "#000000",
  charcoal: "#0d0d0d",
  surface: "#121212",
  surfaceRaised: "#181818",
  muted: "#1c1c1c",
  mutedAlt: "#242424",
  border: "rgba(255,255,255,0.07)",
  rim: "rgba(255,255,255,0.14)",
  borderSoft: "rgba(255,255,255,0.05)",

  red: "#D32531",
  redHover: "#a0000f",
  heart: "#FF5A5A",
  sage: "#34C759",
  blue: "#0084d2",
  cream: "#ede7d3",
  creamShadow: "#d8d0b8",
  shadowGray: "#6D7876",

  text: "#ffffff",
  textMuted: "#a1a1a1",
  textDim: "#7a7a7a",
  textSoft: "#e6e6e6",
  textDisabled: "#4a4a4a",

  accent: "#D32531",
  accentDim: "#a0000f",
  warning: "#ede7d3",
  danger: "#D32531",
  info: "#0084d2",
  badge: "#121212",

  boardDark: "#71828F",
  boardLight: "#C7C7C7",
};

export const result = {
  win: colors.sage,
  draw: colors.textDim,
  loss: colors.red,
  highlight: colors.cream,
  data: colors.blue,
};

// Single type family: Inter. Legacy token names (display/mono) are kept so
// existing call sites keep working — they now resolve to Inter weights.
export const font = {
  display: "Inter_700Bold",
  displayMedium: "Inter_600SemiBold",
  displayLight: "Inter_300Light",
  mono: "Inter_400Regular",
  monoMedium: "Inter_500Medium",
  monoBold: "Inter_600SemiBold",
  sans: "Inter_400Regular",
  sansMedium: "Inter_500Medium",
  sansBold: "Inter_700Bold",
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 44,
};

/** Corner radii. Everything visible should use one of these — no square edges. */
export const radius = {
  xs: 8,
  sm: 12,
  md: 18,
  lg: 24,
  xl: 32,
  pill: 999,
};

/** Type scale. Sizes/line-heights tuned for readability on small screens. */
export const type = {
  hero: { fontFamily: font.sansBold, fontSize: 34, lineHeight: 40, letterSpacing: -0.8 },
  title: { fontFamily: font.sansBold, fontSize: 26, lineHeight: 32, letterSpacing: -0.5 },
  heading: { fontFamily: font.sansBold, fontSize: 20, lineHeight: 26, letterSpacing: -0.3 },
  subheading: { fontFamily: font.sansMedium, fontSize: 16, lineHeight: 22, letterSpacing: -0.1 },
  body: { fontFamily: font.sans, fontSize: 15, lineHeight: 22 },
  bodySmall: { fontFamily: font.sans, fontSize: 13, lineHeight: 19 },
  label: { fontFamily: font.sansMedium, fontSize: 13, lineHeight: 18 },
  caption: { fontFamily: font.sans, fontSize: 12, lineHeight: 17 },
  micro: { fontFamily: font.sans, fontSize: 11, lineHeight: 15 },
  numberLg: {
    fontFamily: font.sansBold,
    fontSize: 44,
    lineHeight: 50,
    letterSpacing: -1.5,
    fontVariant: ["tabular-nums"] as TextStyle["fontVariant"],
  },
  numberMd: {
    fontFamily: font.sansBold,
    fontSize: 28,
    lineHeight: 34,
    letterSpacing: -0.8,
    fontVariant: ["tabular-nums"] as TextStyle["fontVariant"],
  },
  numberSm: {
    fontFamily: font.sansBold,
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: -0.4,
    fontVariant: ["tabular-nums"] as TextStyle["fontVariant"],
  },
};

export function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
