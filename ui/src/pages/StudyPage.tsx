import { useState } from "react"
import { mistakePositions, openingPositions } from "../data/mockData"
import { type FilterState } from "../App"
import { color, font, result, withAlpha } from "../theme"

interface Props { filter: FilterState }

type StudyTab = "mistakes" | "opening"

const PIECES: Record<string, string> = {
  K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘", P: "♙",
  k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟",
}

const BOARD_LIGHT = "#ede7d3"
const BOARD_DARK = "#8b6034"

function parseFEN(fen: string): (string | null)[][] {
  const position = fen.split(" ")[0]
  const rows = position.split("/")
  return rows.map((row) => {
    const squares: (string | null)[] = []
    for (const ch of row) {
      const num = parseInt(ch)
      if (!isNaN(num)) {
        for (let i = 0; i < num; i++) squares.push(null)
      } else {
        squares.push(ch)
      }
    }
    return squares
  })
}

interface HighlightEntry { row: number; col: number; type: "mistake" | "best" | "moved_from" }

function ChessBoard({ fen, highlights = [] }: { fen: string; highlights?: HighlightEntry[] }) {
  const board = parseFEN(fen)

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(8, 1fr)",
        borderRadius: 0,
        overflow: "hidden",
        border: "2px solid #ffffff",
        boxShadow: "0 6px 0 2px #6D7876",
        aspectRatio: "1",
      }}
    >
      {board.map((row, rowIdx) =>
        row.map((piece, colIdx) => {
          const isLight = (rowIdx + colIdx) % 2 === 0
          const highlight = highlights.find((h) => h.row === rowIdx && h.col === colIdx)

          let bgColor = isLight ? BOARD_LIGHT : BOARD_DARK
          if (highlight?.type === "mistake") bgColor = isLight ? withAlpha(result.loss, 0.8) : withAlpha(result.loss, 0.95)
          if (highlight?.type === "best") bgColor = isLight ? withAlpha(result.win, 0.85) : withAlpha(result.win, 0.65)

          const isWhite = piece && piece === piece.toUpperCase()

          return (
            <div
              key={`${rowIdx}-${colIdx}`}
              style={{
                backgroundColor: bgColor,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                aspectRatio: "1",
                position: "relative",
              }}
            >
              {colIdx === 0 && (
                <span
                  style={{
                    position: "absolute",
                    top: 1,
                    left: 2,
                    fontSize: 7,
                    fontFamily: font.mono,
                    fontWeight: 600,
                    color: isLight ? BOARD_DARK : BOARD_LIGHT,
                    lineHeight: 1,
                    pointerEvents: "none",
                    userSelect: "none",
                  }}
                >
                  {8 - rowIdx}
                </span>
              )}
              {rowIdx === 7 && (
                <span
                  style={{
                    position: "absolute",
                    bottom: 1,
                    right: 2,
                    fontSize: 7,
                    fontFamily: font.mono,
                    fontWeight: 600,
                    color: isLight ? BOARD_DARK : BOARD_LIGHT,
                    lineHeight: 1,
                    pointerEvents: "none",
                    userSelect: "none",
                  }}
                >
                  {"abcdefgh"[colIdx]}
                </span>
              )}
              {piece && (
                <span
                  style={{
                    fontSize: "min(4.2vw, 22px)",
                    lineHeight: 1,
                    color: isWhite ? "#fffaf0" : "#12100b",
                    textShadow: isWhite
                      ? "0 1px 3px rgba(0,0,0,0.9), 0 0 1px rgba(0,0,0,0.8)"
                      : "0 1px 2px rgba(255,220,150,0.25)",
                    userSelect: "none",
                    display: "block",
                  }}
                >
                  {PIECES[piece] || piece}
                </span>
              )}
            </div>
          )
        })
      )}
    </div>
  )
}

function MistakesTab() {
  const [current, setCurrent] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const pos = mistakePositions[current]

  const goNext = () => { setCurrent((c) => Math.min(c + 1, mistakePositions.length - 1)); setRevealed(false) }
  const goPrev = () => { setCurrent((c) => Math.max(c - 1, 0)); setRevealed(false) }

  return (
    <div>
      {/* Position header */}
      <div
        style={{
          padding: "12px 16px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderBottom: `1px solid ${color.border}`,
        }}
      >
        <div>
          <div
            style={{
              fontFamily: font.mono,
              fontSize: 9,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: color.ink4,
              marginBottom: 4,
            }}
          >{pos.date} · vs {pos.opponent} ({pos.opponentRating})</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div className="serif-heading" style={{ fontSize: 18, fontWeight: 700 }}>Move {pos.moveNumber}</div>
            <span
              className="pill"
              style={{
                color: result.loss,
                borderColor: withAlpha(result.loss, 0.5),
                background: withAlpha(result.loss, 0.14),
              }}
            >Loss</span>
          </div>
        </div>

        <div style={{ textAlign: "right" }}>
          <div style={{ fontFamily: font.mono, fontSize: 9, color: color.ink4, marginBottom: 3 }}>Eval Change</div>
          <div style={{ fontFamily: font.mono, fontSize: 14, fontWeight: 700, color: result.loss }}>
            {pos.evalBefore} → {pos.evalAfter}
          </div>
        </div>
      </div>

      {/* Eval bar */}
      <div style={{ padding: "10px 16px 0" }}>
        <div style={{ height: 4, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
          <div
            style={{
              height: "100%",
              width: "100%",
              background: `linear-gradient(90deg, ${result.win} 0%, ${result.win} 32%, ${result.loss} 32%)`,
            }}
          />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
          <span style={{ fontFamily: font.mono, fontSize: 8, color: result.win }}>White</span>
          <span style={{ fontFamily: font.mono, fontSize: 8, color: result.loss }}>Black</span>
        </div>
      </div>

      {/* Board */}
      <div style={{ padding: "12px 16px 16px" }}>
        <ChessBoard fen={pos.fen} highlights={pos.highlights} />
      </div>

      {/* Move display */}
      <div style={{ padding: "0 16px 12px" }}>
        <div className="edge-card" style={{ padding: "12px 14px" }}>
          <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
            <div style={{ flex: 1 }}>
              <div
                style={{
                  fontFamily: font.mono,
                  fontSize: 9,
                  textTransform: "uppercase",
                  letterSpacing: "0.12em",
                  color: result.loss,
                  marginBottom: 4,
                }}
              >Played</div>
              <div className="serif-heading" style={{ fontSize: 22, fontWeight: 700, color: result.loss }}>
                {pos.yourMove}
              </div>
            </div>
            {revealed && (
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontFamily: font.mono,
                    fontSize: 9,
                    textTransform: "uppercase",
                    letterSpacing: "0.12em",
                    color: result.win,
                    marginBottom: 4,
                  }}
                >Best Move</div>
                <div className="serif-heading" style={{ fontSize: 22, fontWeight: 700, color: result.win }}>
                  {pos.bestMove}
                </div>
              </div>
            )}
          </div>

          {!revealed ? (
            <button onClick={() => setRevealed(true)} className="brutal-btn" style={{ width: "100%" }}>
              Reveal Best Move
            </button>
          ) : (
            <div
              style={{
                fontFamily: font.sans,
                fontSize: 12,
                color: color.ink3,
                lineHeight: 1.7,
              }}
            >
              {pos.commentary}
            </div>
          )}
        </div>
      </div>

      {/* Navigation */}
      <div style={{ padding: "0 16px", display: "flex", gap: 10, alignItems: "center" }}>
        <button onClick={goPrev} disabled={current === 0} className="brutal-btn ghost" style={{ flex: 1 }}>
          ← Prev
        </button>

        <div
          style={{
            fontFamily: font.mono,
            fontSize: 10,
            color: color.ink4,
            textAlign: "center",
            minWidth: 40,
          }}
        >
          {current + 1}/{mistakePositions.length}
        </div>

        <button
          onClick={goNext}
          disabled={current === mistakePositions.length - 1}
          className="brutal-btn ghost"
          style={{ flex: 1 }}
        >
          Next →
        </button>
      </div>
    </div>
  )
}

function OpeningPrepTab() {
  const [current, setCurrent] = useState(0)
  const [selectedMove, setSelectedMove] = useState<string | null>(null)
  const pos = openingPositions[current]

  const isCorrect = selectedMove === pos.bestMove

  const handleSelect = (move: string) => {
    if (!selectedMove) setSelectedMove(move)
  }

  const handleNext = () => {
    setCurrent((c) => (c + 1) % openingPositions.length)
    setSelectedMove(null)
  }

  const allMoves = selectedMove
    ? [pos.bestMove, ...pos.alternatives]
    : shuffleSeed([pos.bestMove, ...pos.alternatives], current)

  const winRateTone = (rate: number) =>
    rate >= 55 ? result.win : rate >= 48 ? color.cream : result.loss

  return (
    <div>
      {/* Opening info */}
      <div style={{ padding: "12px 16px", borderBottom: `1px solid ${color.border}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div
              style={{
                fontFamily: font.mono,
                fontSize: 9,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: color.cream,
                marginBottom: 4,
              }}
            >{pos.eco} · {pos.gamesPlayed} games</div>
            <div className="serif-heading" style={{ fontSize: 18, fontWeight: 700 }}>{pos.name}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontFamily: font.mono, fontSize: 9, color: color.ink4, marginBottom: 3 }}>Win Rate</div>
            <div className="serif-heading" style={{ fontSize: 22, fontWeight: 700, color: winRateTone(pos.winRate) }}>
              {pos.winRate}%
            </div>
          </div>
        </div>
      </div>

      {/* Board */}
      <div style={{ padding: "12px 16px 16px" }}>
        <ChessBoard fen={pos.fen} highlights={selectedMove ? pos.highlights : []} />
      </div>

      {/* Question */}
      <div style={{ padding: "0 16px 10px" }}>
        <div
          style={{
            fontFamily: font.display,
            fontSize: 16,
            color: color.ink,
            marginBottom: 12,
            lineHeight: 1.4,
          }}
        >{pos.question}</div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {allMoves.map((move) => {
            const isSelected = selectedMove === move
            const isBest = selectedMove && move === pos.bestMove
            const isWrong = isSelected && !isCorrect

            let btnBg: string = "rgba(255,255,255,0.04)"
            let btnBorder: string = color.border
            let btnColor: string = color.ink

            if (isBest) { btnBg = withAlpha(result.win, 0.16); btnBorder = result.win; btnColor = result.win }
            if (isWrong) { btnBg = withAlpha(result.loss, 0.14); btnBorder = result.loss; btnColor = result.loss }

            return (
              <button
                key={move}
                onClick={() => handleSelect(move)}
                disabled={!!selectedMove}
                style={{
                  padding: "12px",
                  background: btnBg,
                  border: `1px solid ${btnBorder}`,
                  borderRadius: 0,
                  color: btnColor,
                  fontFamily: font.display,
                  fontSize: 18,
                  fontWeight: 700,
                  cursor: selectedMove ? "default" : "pointer",
                  transition: "all 0.15s",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                {isBest && "✓ "}
                {isWrong && "✗ "}
                {move}
              </button>
            )
          })}
        </div>

        {/* Commentary */}
        {selectedMove && (
          <div
            className="edge-card"
            style={{
              marginTop: 12,
              borderLeft: `3px solid ${isCorrect ? result.win : result.loss}`,
              padding: "10px 12px",
            }}
          >
            <div
              style={{
                fontFamily: font.mono,
                fontSize: 9,
                textTransform: "uppercase",
                letterSpacing: "0.14em",
                color: isCorrect ? result.win : result.loss,
                marginBottom: 6,
              }}
            >{isCorrect ? "Correct!" : `Best was ${pos.bestMove}`}</div>
            <div style={{ fontFamily: font.sans, fontSize: 12, color: color.ink3, lineHeight: 1.7 }}>
              {pos.commentary}
            </div>
          </div>
        )}

        {/* Next button */}
        {selectedMove && (
          <button onClick={handleNext} className="brutal-btn" style={{ marginTop: 14, width: "100%" }}>
            Next Position →
          </button>
        )}
      </div>

      {/* Opening list */}
      <div className="paper-list" style={{ padding: "8px 16px 0" }}>
        <div
          style={{
            fontFamily: font.mono,
            fontSize: 9,
            textTransform: "uppercase",
            letterSpacing: "0.2em",
            color: color.ink4,
            marginBottom: 10,
          }}
        >Your Repertoire</div>
        {openingPositions.map((op, i) => (
          <button
            key={op.id}
            onClick={() => { setCurrent(i); setSelectedMove(null) }}
            className="paper-item"
            style={{
              width: "100%",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "12px",
              background: current === i ? withAlpha(color.cream, 0.08) : "rgba(255,255,255,0.03)",
              border: `1px solid ${current === i ? withAlpha(color.cream, 0.35) : color.border}`,
              borderRadius: 0,
              marginBottom: 8,
              cursor: "pointer",
            }}
          >
            <div style={{ textAlign: "left" }}>
              <div
                className="paper-item-title"
                style={{ fontFamily: font.display, fontSize: 15, fontWeight: 600, color: color.ink }}
              >{op.name}</div>
              <div
                className="paper-item-meta"
                style={{ fontFamily: font.mono, fontSize: 9, color: color.ink4, marginTop: 2 }}
              >{op.eco} · {op.gamesPlayed} games</div>
            </div>
            <div
              className="serif-heading"
              style={{ fontSize: 17, fontWeight: 700, color: winRateTone(op.winRate) }}
            >{op.winRate}%</div>
          </button>
        ))}
      </div>
    </div>
  )
}

function shuffleSeed<T>(arr: T[], seed: number): T[] {
  const copy = [...arr]
  let s = seed
  for (let i = copy.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) & 0xffffffff
    const j = Math.abs(s) % (i + 1)
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

export default function StudyPage({ filter: _filter }: Props) {
  const [activeTab, setActiveTab] = useState<StudyTab>("mistakes")

  return (
    <div style={{ paddingBottom: 90 }}>
      {/* Header */}
      <div style={{ padding: "24px 16px 0" }}>
        <div className="serif-heading" style={{ fontSize: 32, fontWeight: 700, marginBottom: 16 }}>
          Study Board
        </div>

        {/* Tab switcher */}
        <div style={{ display: "flex", gap: 8, marginBottom: 4 }}>
          {([
            { id: "mistakes" as StudyTab, label: "Critical Mistakes" },
            { id: "opening" as StudyTab, label: "Opening Prep" },
          ] as const).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`filter-rect ${activeTab === tab.id ? "active" : "idle"}`}
              style={{ flex: 1, fontSize: 10, padding: "9px 8px" }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div style={{ paddingTop: 16 }}>
        {activeTab === "mistakes" ? <MistakesTab /> : <OpeningPrepTab />}
      </div>
    </div>
  )
}
