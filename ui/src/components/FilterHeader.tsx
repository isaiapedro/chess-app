import { type CSSProperties } from "react"
import { type FilterState, type TimeRange, type ChessFormat } from "../App"
import { color, font } from "../theme"

interface Props {
  filter: FilterState
  onChange: (f: FilterState) => void
}

const timeRanges: { id: TimeRange; label: string }[] = [
  { id: "yearly", label: "Year" },
  { id: "monthly", label: "Month" },
  { id: "weekly", label: "Week" },
  { id: "daily", label: "Day" },
]

const formats: { id: ChessFormat; label: string; symbol: string }[] = [
  { id: "classical", label: "Classical", symbol: "♔" },
  { id: "rapid", label: "Rapid", symbol: "♞" },
  { id: "blitz", label: "Blitz", symbol: "♝" },
  { id: "bullet", label: "Bullet", symbol: "♟" },
]

const labelStyle: CSSProperties = {
  fontFamily: font.mono,
  fontSize: 8,
  letterSpacing: "0.2em",
  textTransform: "uppercase",
  color: color.ink4,
  marginBottom: 5,
  display: "block",
}

export default function FilterHeader({ filter, onChange }: Props) {
  const setTimeRange = (t: TimeRange) => onChange({ ...filter, timeRange: t })
  const setFormat = (f: ChessFormat) => onChange({ ...filter, chessFormat: f })
  const setDate = (d: string) => onChange({ ...filter, selectedDate: d })

  return (
    <div
      style={{
        background: "rgba(0,0,0,0.96)",
        backdropFilter: "blur(12px)",
        borderBottom: `1px solid ${color.rim}`,
        position: "sticky",
        top: 0,
        zIndex: 50,
        padding: "12px 16px",
      }}
    >
      <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
        <div className="select-group">
          <label htmlFor="timeframe-select" style={labelStyle}>
            Timeframe
          </label>
          <div className="select-wrap">
            <select
              id="timeframe-select"
              className="select-field"
              value={filter.timeRange}
              onChange={(e) => setTimeRange(e.target.value as TimeRange)}
            >
              {timeRanges.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="select-group">
          <label htmlFor="format-select" style={labelStyle}>
            Time Format
          </label>
          <div className="select-wrap">
            <select
              id="format-select"
              className="select-field"
              value={filter.chessFormat}
              onChange={(e) => setFormat(e.target.value as ChessFormat)}
            >
              {formats.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.symbol}  {f.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {filter.timeRange === "daily" && (
        <div style={{ marginTop: 10 }}>
          <input
            type="date"
            value={filter.selectedDate}
            onChange={(e) => setDate(e.target.value)}
            style={{
              width: "100%",
              padding: "9px 12px",
              background: color.cream,
              border: "1px solid #000000",
              borderRadius: 0,
              color: "#111111",
              fontSize: 12,
              fontFamily: font.mono,
              fontWeight: 600,
              outline: "none",
              boxShadow: "0px 3px 0px 0px #6D7876",
            }}
          />
        </div>
      )}
    </div>
  )
}
