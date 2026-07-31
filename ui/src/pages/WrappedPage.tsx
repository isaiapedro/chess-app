import { useState, type ReactNode } from "react"
import { AreaChart, Area, BarChart, Bar, XAxis, Tooltip, ResponsiveContainer } from "recharts"
import { playerStats, monthlyActivity, hourlyActivity, archetypes, comparisons } from "../data/mockData"
import { type FilterState } from "../App"
import { color, font, result, withAlpha } from "../theme"

interface Props { filter: FilterState }

const formatLabel: Record<string, string> = {
  classical: "Classical",
  rapid: "Rapid",
  blitz: "Blitz",
  bullet: "Bullet",
}

const timeLabel: Record<string, string> = {
  yearly: "2024",
  monthly: "This Month",
  weekly: "This Week",
  daily: "Today",
}

const tooltipStyle = {
  background: color.muted,
  border: `1px solid ${color.border}`,
  borderRadius: 0,
  color: color.ink,
  fontFamily: font.mono,
  fontSize: 11,
}

const cardStyle = {
  background: color.card,
  border: `1px solid ${color.border}`,
  borderRadius: 0,
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        fontFamily: font.mono,
        fontSize: 9,
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        color: color.ink4,
        marginBottom: 10,
      }}
    >
      {children}
    </div>
  )
}

export default function WrappedPage({ filter }: Props) {
  const [activeArchetype, setActiveArchetype] = useState(0)

  const period = timeLabel[filter.timeRange] || "2024"
  const fmt = formatLabel[filter.chessFormat]
  const archetype = archetypes[activeArchetype]

  return (
    <div style={{ paddingBottom: 90 }}>

      {/* Hero */}
      <div
        style={{
          background: `radial-gradient(ellipse 120% 60% at 50% 0%, ${withAlpha(color.red, 0.14)} 0%, transparent 70%)`,
          padding: "32px 20px 20px",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            right: -20,
            top: -10,
            fontSize: 170,
            lineHeight: 1,
            opacity: 0.05,
            userSelect: "none",
            fontFamily: font.display,
          }}
        >♟</div>

        <div
          style={{
            fontFamily: font.mono,
            fontSize: 10,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            color: color.red,
            marginBottom: 8,
            fontWeight: 600,
          }}
        >
          {fmt} · {period}
        </div>

        <div
          className="serif-heading"
          style={{
            fontSize: 42,
            fontWeight: 700,
            marginBottom: 8,
          }}
        >
          Your Year<br />in Chess
        </div>

        <div className="article-byline">@{playerStats.username}</div>
      </div>

      {/* Peak rating */}
      <div
        style={{
          padding: "16px 20px 0",
          display: "flex",
          alignItems: "flex-end",
          gap: 12,
        }}
      >
        <div>
          <div
            style={{
              fontFamily: font.mono,
              fontSize: 9,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: color.ink4,
              marginBottom: 4,
            }}
          >Peak Rating</div>
          <div
            className="serif-heading"
            style={{
              fontSize: 76,
              fontWeight: 800,
              lineHeight: 0.95,
              letterSpacing: "-2px",
            }}
          >
            {playerStats.peakRating}
          </div>
        </div>
        <div style={{ paddingBottom: 10 }}>
          <span
            className="pill"
            style={{
              color: result.win,
              borderColor: withAlpha(result.win, 0.45),
              background: withAlpha(result.win, 0.12),
              fontWeight: 600,
              fontSize: 11,
            }}
          >
            +{playerStats.ratingChange}
          </span>
        </div>
      </div>

      {/* Key stats grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 8,
          padding: "16px 16px 0",
        }}
      >
        {[
          { label: "Games Played", value: playerStats.totalGames.toLocaleString(), sub: `${playerStats.wins}W · ${playerStats.draws}D · ${playerStats.losses}L` },
          { label: "Win Rate", value: `${playerStats.winRate}%`, sub: "58th percentile" },
          { label: "Time Invested", value: `${playerStats.timeSpentHours}h`, sub: `${playerStats.timeSpentMinutes}m remaining` },
          { label: "Moves Made", value: playerStats.totalMoves.toLocaleString(), sub: `Avg ${playerStats.avgGameLength} per game` },
        ].map((stat) => (
          <div key={stat.label} className="edge-card lifted" style={{ padding: "14px" }}>
            <div
              style={{
                fontFamily: font.mono,
                fontSize: 9,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: color.ink4,
                marginBottom: 8,
              }}
            >{stat.label}</div>
            <div
              className="serif-heading"
              style={{
                fontSize: 34,
                fontWeight: 700,
                lineHeight: 1,
                marginBottom: 6,
              }}
            >{stat.value}</div>
            <div
              style={{
                fontFamily: font.sans,
                fontSize: 11,
                color: color.ink4,
              }}
            >{stat.sub}</div>
          </div>
        ))}
      </div>

      {/* Rating progression */}
      <div style={{ ...cardStyle, margin: "16px 16px 0", padding: "14px 14px 10px" }}>
        <SectionLabel>Rating Progression · 2024</SectionLabel>
        <ResponsiveContainer width="100%" height={90}>
          <AreaChart data={monthlyActivity} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="ratingGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={result.win} stopOpacity={0.3} />
                <stop offset="95%" stopColor={result.win} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="month" tick={{ fill: color.ink4, fontSize: 9, fontFamily: "IBM Plex Mono" }} axisLine={false} tickLine={false} />
            <Tooltip
              contentStyle={tooltipStyle}
              itemStyle={{ color: result.win }}
              cursor={{ stroke: color.rim }}
            />
            <Area type="monotone" dataKey="rating" stroke={result.win} strokeWidth={2} fill="url(#ratingGrad)" dot={false} activeDot={{ r: 3, fill: result.win }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Activity by month */}
      <div style={{ ...cardStyle, margin: "8px 16px 0", padding: "14px 14px 10px" }}>
        <SectionLabel>Games by Month</SectionLabel>
        <ResponsiveContainer width="100%" height={80}>
          <BarChart data={monthlyActivity} margin={{ top: 0, right: 0, bottom: 0, left: 0 }} barGap={2}>
            <XAxis dataKey="month" tick={{ fill: color.ink4, fontSize: 9, fontFamily: "IBM Plex Mono" }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(255,255,255,0.05)" }} />
            <Bar dataKey="wins" name="Wins" fill={result.win} opacity={0.9} radius={[0, 0, 0, 0]} />
            <Bar dataKey="games" name="Games" fill="rgba(255,255,255,0.14)" radius={[0, 0, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Peak hours */}
      <div style={{ ...cardStyle, margin: "8px 16px 0", padding: "14px 14px 10px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
          <div
            style={{
              fontFamily: font.mono,
              fontSize: 9,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: color.ink4,
            }}
          >When You Play</div>
          <div style={{ fontFamily: font.sans, fontSize: 11, color: color.ink4 }}>
            Peak: <span style={{ color: color.cream, fontWeight: 600 }}>10 PM</span>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={60}>
          <BarChart data={hourlyActivity} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
            <XAxis dataKey="hour" tick={{ fill: color.ink4, fontSize: 8, fontFamily: "IBM Plex Mono" }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(255,255,255,0.05)" }} />
            <Bar dataKey="games" fill={color.cream} opacity={0.8} radius={[0, 0, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Archetypes */}
      <div style={{ padding: "20px 16px 0" }}>
        <SectionLabel>Your Playing Archetypes</SectionLabel>

        <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 6 }}>
          {archetypes.map((arch, i) => {
            const isActive = activeArchetype === i
            return (
              <button
                key={arch.name}
                onClick={() => setActiveArchetype(i)}
                style={{
                  flexShrink: 0,
                  background: isActive ? withAlpha(arch.color, 0.14) : "rgba(255,255,255,0.04)",
                  border: `1px solid ${isActive ? arch.color : color.border}`,
                  borderRadius: 0,
                  padding: "10px 14px",
                  cursor: "pointer",
                  transition: "all 0.15s",
                  textAlign: "left",
                  minWidth: 112,
                  boxShadow: isActive ? `4px 4px 0 0 ${withAlpha(arch.color, 0.25)}` : "none",
                }}
              >
                <div style={{ fontSize: 18, marginBottom: 6, color: arch.color }}>{arch.symbol}</div>
                <div
                  className="serif-heading"
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: isActive ? arch.color : color.ink2,
                  }}
                >{arch.name}</div>
              </button>
            )
          })}
        </div>

        {/* Archetype note on paper */}
        <div style={{ padding: "22px 6px 8px" }}>
          <div className="paper-card" style={{ padding: "22px 20px 20px" }}>
            <div className="tape" />
            <div
              className="typewriter-label"
              style={{
                fontSize: 10,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: "#6b6355",
                marginBottom: 6,
              }}
            >
              {archetype.symbol} {archetype.name}
            </div>
            <div
              style={{
                fontFamily: font.display,
                fontSize: 16,
                lineHeight: 1.55,
                color: "#1c1a16",
                position: "relative",
                zIndex: 1,
              }}
            >
              {archetype.desc}
            </div>
          </div>
        </div>
      </div>

      {/* Fun comparisons */}
      <div style={{ padding: "12px 16px 0" }}>
        <SectionLabel>What You Could Have Done Instead</SectionLabel>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {comparisons.map((c) => (
            <div key={c.label} className="edge-card" style={{ padding: "12px" }}>
              <div style={{ fontSize: 16, marginBottom: 8, color: color.red }}>{c.icon}</div>
              <div
                className="serif-heading"
                style={{
                  fontSize: 30,
                  fontWeight: 700,
                  lineHeight: 1,
                  marginBottom: 6,
                }}
              >{c.value}</div>
              <div
                style={{
                  fontFamily: font.sans,
                  fontSize: 10,
                  color: color.ink4,
                  lineHeight: 1.4,
                }}
              >{c.label}</div>
            </div>
          ))}
        </div>
      </div>

    </div>
  )
}
