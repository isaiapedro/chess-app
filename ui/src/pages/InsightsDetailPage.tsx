import { useState } from "react"
import { BarChart, Bar, Cell, ResponsiveContainer } from "recharts"
import { catalogSections } from "../data/mockData"
import { type FilterState } from "../App"
import { color, font, result, withAlpha } from "../theme"

type SectionKey = keyof typeof catalogSections

interface Props { filter: FilterState }

const sectionKeys: SectionKey[] = ["style", "openings", "middlegame", "endgame"]

export default function InsightsDetailPage({ filter: _filter }: Props) {
  const [search, setSearch] = useState("")
  const [activeSection, setActiveSection] = useState<SectionKey | null>(null)

  const matches = (name: string, desc: string) =>
    !search ||
    name.toLowerCase().includes(search.toLowerCase()) ||
    desc.toLowerCase().includes(search.toLowerCase())

  const filtered = activeSection
    ? {
        [activeSection]: {
          ...catalogSections[activeSection],
          metrics: catalogSections[activeSection].metrics.filter((m) => matches(m.name, m.desc)),
        },
      }
    : Object.fromEntries(
        sectionKeys.map((k) => [
          k,
          {
            ...catalogSections[k],
            metrics: catalogSections[k].metrics.filter((m) => matches(m.name, m.desc)),
          },
        ])
      )

  const hasSearchResults = Object.values(filtered).some((s) => s.metrics.length > 0)

  return (
    <div style={{ paddingBottom: 90 }}>

      {/* Header */}
      <div style={{ padding: "24px 16px 16px" }}>
        <div className="serif-heading" style={{ fontSize: 32, fontWeight: 700, marginBottom: 16 }}>
          {activeSection ? catalogSections[activeSection].title : "Metrics Catalog"}
        </div>

        {/* Search bar */}
        <div style={{ position: "relative" }}>
          <div
            style={{
              position: "absolute",
              left: 14,
              top: "50%",
              transform: "translateY(-50%)",
              color: color.ink4,
              fontSize: 14,
              pointerEvents: "none",
            }}
          >⌕</div>
          <input
            type="text"
            className="search-input"
            placeholder="Search metrics..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              style={{
                position: "absolute",
                right: 12,
                top: "50%",
                transform: "translateY(-50%)",
                background: "none",
                border: "none",
                color: color.ink4,
                cursor: "pointer",
                fontSize: 14,
                padding: 2,
              }}
            >✕</button>
          )}
        </div>
      </div>

      {/* Category grid */}
      {!activeSection && !search && (
        <div style={{ padding: "0 16px 16px" }}>
          <div
            style={{
              fontFamily: font.mono,
              fontSize: 9,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: color.ink4,
              marginBottom: 10,
            }}
          >Categories</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {sectionKeys.map((key) => {
              const section = catalogSections[key]
              return (
                <button
                  key={key}
                  onClick={() => setActiveSection(key)}
                  className="edge-card"
                  style={{
                    borderTop: `3px solid ${section.color}`,
                    padding: "16px 14px",
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "background 0.15s",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = color.muted }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = color.card }}
                >
                  <div style={{ fontSize: 22, marginBottom: 8, color: section.color }}>{section.icon}</div>
                  <div className="serif-heading" style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
                    {section.title}
                  </div>
                  <div
                    style={{
                      fontFamily: font.mono,
                      fontSize: 9,
                      color: color.ink4,
                      letterSpacing: "0.1em",
                    }}
                  >{section.metrics.length} metrics</div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Back link */}
      {activeSection && !search && (
        <div style={{ padding: "0 16px 12px" }}>
          <button
            onClick={() => setActiveSection(null)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              background: "none",
              border: "none",
              color: color.sage,
              cursor: "pointer",
              padding: 0,
              fontFamily: font.mono,
              fontSize: 11,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
            }}
          >
            ← All Categories
          </button>
        </div>
      )}

      {/* Section chips */}
      {activeSection && (
        <div style={{ padding: "0 16px 12px", display: "flex", gap: 6 }}>
          {sectionKeys.map((key) => {
            const isActive = activeSection === key
            return (
              <button
                key={key}
                onClick={() => setActiveSection(key)}
                className="meta-tag"
                style={{
                  fontSize: 13,
                  padding: "4px 12px",
                  background: isActive ? withAlpha(catalogSections[key].color, 0.16) : "transparent",
                  borderColor: isActive ? catalogSections[key].color : color.border,
                  color: isActive ? catalogSections[key].color : color.ink4,
                }}
              >
                {catalogSections[key].icon}
              </button>
            )
          })}
        </div>
      )}

      {/* No results */}
      {!hasSearchResults && (
        <div
          style={{
            padding: "20px 16px",
            textAlign: "center",
            color: color.ink4,
            fontFamily: font.sans,
            fontSize: 13,
          }}
        >
          No metrics found for "{search}"
        </div>
      )}

      {/* Metric cards */}
      {(activeSection ? [activeSection] : sectionKeys).map((key) => {
        const sk = key as SectionKey
        const section = (filtered as typeof catalogSections)[sk]
        if (!section || section.metrics.length === 0) return null
        return (
          <div key={sk} style={{ padding: "0 16px 8px" }}>
            {(!activeSection || search) && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <span style={{ color: section.color, fontSize: 14 }}>{section.icon}</span>
                <div
                  style={{
                    fontFamily: font.mono,
                    fontSize: 9,
                    letterSpacing: "0.18em",
                    textTransform: "uppercase",
                    color: section.color,
                    fontWeight: 700,
                  }}
                >{section.title}</div>
                <div style={{ flex: 1, height: 1, background: color.border }} />
              </div>
            )}
            {section.metrics.map((metric) => {
              const isAbove = metric.value >= metric.avg
              const accent = isAbove ? result.win : result.loss
              const chartData = [
                { label: "You", value: metric.value },
                { label: "Avg", value: metric.avg },
              ]
              return (
                <div key={metric.name} className="edge-card" style={{ padding: "14px", marginBottom: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
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
                      >{metric.name}</div>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
                        <span className="serif-heading" style={{ fontSize: 24, fontWeight: 700, lineHeight: 1 }}>
                          {metric.value}{metric.unit}
                        </span>
                        <span
                          style={{
                            fontFamily: font.mono,
                            fontSize: 10,
                            color: accent,
                            fontWeight: 600,
                          }}
                        >{isAbove ? "↑" : "↓"} avg {metric.avg}{metric.unit}</span>
                      </div>
                      <div
                        style={{
                          fontFamily: font.sans,
                          fontSize: 11,
                          color: color.ink4,
                          lineHeight: 1.5,
                        }}
                      >{metric.desc}</div>
                    </div>

                    {/* Mini bar chart */}
                    <div style={{ width: 56, height: 44, flexShrink: 0 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chartData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }} barGap={4}>
                          <Bar dataKey="value">
                            {chartData.map((_entry, index) => (
                              <Cell key={index} fill={index === 0 ? accent : "rgba(255,255,255,0.18)"} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                      <div style={{ display: "flex", justifyContent: "space-around", marginTop: 2 }}>
                        <span style={{ fontFamily: font.mono, fontSize: 7, color: color.ink4 }}>You</span>
                        <span style={{ fontFamily: font.mono, fontSize: 7, color: color.ink4 }}>Avg</span>
                      </div>
                    </div>
                  </div>

                  {/* Comparison bar */}
                  <div style={{ marginTop: 12 }}>
                    <div style={{ position: "relative", height: 3, background: "rgba(255,255,255,0.08)" }}>
                      <div
                        style={{
                          position: "absolute",
                          left: 0,
                          top: 0,
                          height: "100%",
                          width: `${Math.min(100, (metric.value / (Math.max(metric.value, metric.avg) * 1.2)) * 100)}%`,
                          background: accent,
                        }}
                      />
                      <div
                        style={{
                          position: "absolute",
                          left: `${(metric.avg / (Math.max(metric.value, metric.avg) * 1.2)) * 100}%`,
                          top: -2,
                          width: 2,
                          height: 7,
                          background: color.rim,
                        }}
                      />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )
      })}

    </div>
  )
}
