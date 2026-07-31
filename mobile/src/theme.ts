export const colors = {
  bg: "#000000",
  charcoal: "#0d0d0d",
  surface: "#1a1a1a",
  surfaceRaised: "#1d1d1d",
  muted: "#222222",
  mutedAlt: "#2b2b2b",
  border: "#333333",
  rim: "rgba(255,255,255,0.2)",
  borderSoft: "rgba(255,255,255,0.08)",

  red: "#D32531",
  redHover: "#a0000f",
  heart: "#FF5A5A",
  sage: "#34C759",
  blue: "#0084d2",
  cream: "#ede7d3",
  creamShadow: "#d8d0b8",
  shadowGray: "#6D7876",

  text: "#ffffff",
  textMuted: "#aaaaaa",
  textDim: "#888888",
  textSoft: "#e0e0e0",
  textDisabled: "#444444",

  accent: "#D32531",
  accentDim: "#a0000f",
  warning: "#ede7d3",
  danger: "#D32531",
  info: "#0084d2",
  badge: "#1a1a1a",

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

export const font = {
  display: "PlayfairDisplay_700Bold",
  displayMedium: "PlayfairDisplay_600SemiBold",
  mono: "IBMPlexMono_400Regular",
  monoMedium: "IBMPlexMono_500Medium",
  monoBold: "IBMPlexMono_700Bold",
  sans: "System",
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

export function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
