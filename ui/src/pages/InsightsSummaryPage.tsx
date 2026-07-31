import { LineChart, Line, ResponsiveContainer } from "recharts"
import { winFactors, lossFactors, monthlyActivity } from "../data/mockData"
import { type FilterState } from "../App"
import { color, font, result, withAlpha } from "../theme"

interface Props {
  filter: FilterState
  onOpenCatalog: () => void
}

function FactorCard({
  name, value, avg, delta, positive, description, chartData,
}: {
  name: string; value: string; avg: string; delta: string; positive: boolean; description: string; chartData: number[]
}) {
  const accent = positive ? result.win : result.loss
  const chartFormatted = chartData.map((v, i) => ({ i, v }))

  return (
    <div
      className="edge-card"
      style={{
        borderLeft: `3px solid ${accent}`,
        padding: "14px",
        marginBottom: 8,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
        <div style={{ flex: 1, paddingRight: 12 }}>
          <div
            style={{
              fontFamily: font.mono,
              fontSize: 9,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: color.ink4,
              marginBottom: 6,
            }}
          >{name}</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span
              className="serif-heading"
              style={{ fontSize: 28, fontWeight: 700, lineHeight: 1 }}
            >{value}</span>
            <span
              style={{
                fontFamily: font.mono,
                fontSize: 11,
                fontWeight: 600,
                color: accent,
              }}
            >{delta}</span>
          </div>
          <div
            style={{
              fontFamily: font.mono,
              fontSize: 10,
              color: color.ink4,
              marginTop: 4,
            }}
          >avg {avg}</div>
        </div>
        <div style={{ width: 70, height: 40 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartFormatted}>
              <Line type="monotone" dataKey="v" stroke={accent} strokeWidth={1.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Benchmark bar */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ position: "relative", height: 4, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              height: "100%",
              width: positive ? "74%" : "31%",
              background: accent,
              transition: "width 0.6s ease",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: positive ? "68%" : "44%",
              top: -1,
              width: 2,
              height: 6,
              background: color.rim,
            }}
          />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 5 }}>
          <span style={{ fontFamily: font.mono, fontSize: 9, color: color.ink4 }}>You</span>
          <span style={{ fontFamily: font.mono, fontSize: 9, color: color.ink4 }}>Platform avg</span>
        </div>
      </div>

      <div
        style={{
          fontFamily: font.sans,
          fontSize: 12,
          color: color.ink3,
          lineHeight: 1.6,
        }}
      >{description}</div>
    </div>
  )
}

function GroupHeading({ label, accent }: { label: string; accent: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
      <div style={{ width: 8, height: 8, background: accent }} />
      <div
        style={{
          fontFamily: font.mono,
          fontSize: 9,
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          color: accent,
          fontWeight: 700,
        }}
      >{label}</div>
      <div style={{ flex: 1, height: 1, background: color.border }} />
    </div>
  )
}

export default function InsightsSummaryPage({ filter: _filter, onOpenCatalog }: Props) {
  const winRate = 58

  return (
    <div style={{ paddingBottom: 90 }}>

      {/* Header */}
      <div
        style={{
          background: `radial-gradient(ellipse 100% 50% at 50% 0%, ${withAlpha(color.red, 0.12)} 0%, transparent 70%)`,
          padding: "28px 20px 20px",
        }}
      >
        <div
          style={{
            fontFamily: font.mono,
            fontSize: 10,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            color: color.red,
            marginBottom: 8,
          }}
        >Performance Analysis</div>
        <div className="serif-heading" style={{ fontSize: 34, fontWeight: 700 }}>
          What Moves<br />the Needle
        </div>
      </div>

      {/* Win/loss dial summary */}
      <div
        className="edge-card lifted"
        style={{
          margin: "0 16px 16px",
          padding: "14px",
          display: "flex",
          alignItems: "center",
          gap: 16,
        }}
      >
        <div style={{ position: "relative", flexShrink: 0 }}>
          <div
            style={{
              width: 68,
              height: 68,
              borderRadius: "50%",
              background: `conic-gradient(${color.blue} ${winRate}%, rgba(255,255,255,0.1) 0)`,
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 8,
              borderRadius: "50%",
              background: color.cardRaised,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span className="serif-heading" style={{ fontSize: 15, fontWeight: 700 }}>{winRate}%</span>
          </div>
        </div>

        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", gap: 14, marginBottom: 6 }}>
            {[
              { label: "Wins", value: 491, tone: result.win },
              { label: "Draws", value: 98, tone: result.draw },
              { label: "Losses", value: 258, tone: result.loss },
            ].map((item) => (
              <div key={item.label}>
                <div className="serif-heading" style={{ fontSize: 20, fontWeight: 700, color: item.tone }}>{item.value}</div>
                <div
                  style={{
                    fontFamily: font.mono,
                    fontSize: 9,
                    textTransform: "uppercase",
                    letterSpacing: "0.12em",
                    color: color.ink4,
                  }}
                >{item.label}</div>
              </div>
            ))}
          </div>

          <div style={{ height: 28, marginTop: 4 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthlyActivity}>
                <Line type="monotone" dataKey="rating" stroke={color.blue} strokeWidth={1.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* What's working */}
      <div style={{ padding: "0 16px" }}>
        <GroupHeading label="Driving Your Wins" accent={result.win} />
        {winFactors.map((f) => (
          <FactorCard key={f.name} {...f} />
        ))}
      </div>

      {/* What's costing you */}
      <div style={{ padding: "8px 16px 0" }}>
        <GroupHeading label="Costing You Points" accent={result.loss} />
        {lossFactors.map((f) => (
          <FactorCard key={f.name} {...f} />
        ))}
      </div>

      {/* CTA to catalog */}
      <div style={{ padding: "16px 16px 0" }}>
        <button
          onClick={onOpenCatalog}
          className="brutal-btn"
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            textAlign: "left",
          }}
        >
          <span>
            <span
              className="serif-heading"
              style={{ display: "block", fontSize: 16, fontWeight: 700, textTransform: "none", letterSpacing: 0 }}
            >Explore All Metrics</span>
            <span
              style={{
                display: "block",
                fontFamily: font.mono,
                fontSize: 9,
                letterSpacing: "0.1em",
                fontWeight: 400,
                color: "rgba(255,255,255,0.85)",
                marginTop: 2,
              }}
            >Style · Openings · Middlegames · Endgames</span>
          </span>
          <span style={{ fontSize: 18 }}>→</span>
        </button>
      </div>

    </div>
  )
}
