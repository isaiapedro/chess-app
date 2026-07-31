export const font = {
  display: "'Playfair Display', Georgia, serif",
  mono: "'IBM Plex Mono', 'Courier New', monospace",
  sans: "'Helvetica', 'Inter', system-ui, sans-serif",
  typewriter: "'Special Elite', 'IBM Plex Mono', monospace",
} as const

export const color = {
  red: "#D32531",
  redHover: "#a0000f",
  heart: "#FF5A5A",
  sage: "#A5CEC7",
  blue: "#0084d2",
  success: "#7cfc7c",

  cream: "#ede7d3",
  creamShadow: "#d8d0b8",

  black: "#000000",
  charcoal: "#0d0d0d",
  card: "#1a1a1a",
  cardRaised: "#1d1d1d",
  muted: "#222222",
  mutedAlt: "#2b2b2b",

  border: "#333333",
  borderSoft: "rgba(255,255,255,0.08)",
  rim: "rgba(255,255,255,0.2)",

  ink: "#ffffff",
  ink2: "#e0e0e0",
  ink3: "#aaaaaa",
  ink4: "#888888",
  inkDisabled: "#444444",
} as const

export const result = {
  win: color.sage,
  draw: color.ink4,
  loss: color.red,
  highlight: color.cream,
  data: color.blue,
} as const

export const surface = {
  page: color.black,
  card: {
    background: color.card,
    border: `1px solid ${color.border}`,
    borderRadius: 0,
  },
} as const

export function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}
