import { type Page } from "../App"
import { color, font } from "../theme"

interface Props {
  activePage: Page
  onNavigate: (p: Page) => void
}

const tabs: { id: Page; label: string }[] = [
  { id: "wrapped", label: "Wrapped" },
  { id: "insights", label: "Insights" },
  { id: "catalog", label: "Catalog" },
  { id: "study", label: "Study" },
]

function WrappedIcon({ active }: { active: boolean }) {
  const c = active ? color.red : color.ink4
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M10 2L12.5 7.5H18L13.5 11L15.5 17L10 13.5L4.5 17L6.5 11L2 7.5H7.5L10 2Z"
        fill={active ? color.red : "none"}
        stroke={c}
        strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
}

function InsightsIcon({ active }: { active: boolean }) {
  const c = active ? color.red : color.ink4
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <rect x="2" y="12" width="3" height="6" fill={c} opacity={active ? 1 : 0.6} />
      <rect x="6.5" y="8" width="3" height="10" fill={c} opacity={active ? 1 : 0.7} />
      <rect x="11" y="5" width="3" height="13" fill={c} opacity={active ? 1 : 0.85} />
      <rect x="15.5" y="2" width="3" height="16" fill={c} />
    </svg>
  )
}

function CatalogIcon({ active }: { active: boolean }) {
  const c = active ? color.red : color.ink4
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <rect x="2" y="2" width="7" height="7" stroke={c} strokeWidth="1.5" fill={active ? "rgba(211,37,49,0.2)" : "none"} />
      <rect x="11" y="2" width="7" height="7" stroke={c} strokeWidth="1.5" fill={active ? "rgba(211,37,49,0.2)" : "none"} />
      <rect x="2" y="11" width="7" height="7" stroke={c} strokeWidth="1.5" fill={active ? "rgba(211,37,49,0.2)" : "none"} />
      <rect x="11" y="11" width="7" height="7" stroke={c} strokeWidth="1.5" fill={active ? "rgba(211,37,49,0.2)" : "none"} />
    </svg>
  )
}

function StudyIcon({ active }: { active: boolean }) {
  const c = active ? color.red : color.ink4
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M10 3C8.5 3 7 4 7 5.5C7 7 8 7.5 8 8.5C8 9.5 7 10 7 11H13C13 10 12 9.5 12 8.5C12 7.5 13 7 13 5.5C13 4 11.5 3 10 3Z"
        fill={active ? "rgba(211,37,49,0.3)" : "none"} stroke={c} strokeWidth="1.5" strokeLinejoin="round" />
      <rect x="7" y="12" width="6" height="1.5" fill={c} />
      <rect x="7.5" y="14.5" width="5" height="1.5" fill={c} />
      <rect x="8.5" y="17" width="3" height="1" fill={c} />
    </svg>
  )
}

export default function BottomNav({ activePage, onNavigate }: Props) {
  const icons = {
    wrapped: WrappedIcon,
    insights: InsightsIcon,
    catalog: CatalogIcon,
    study: StudyIcon,
  }

  return (
    <div
      style={{
        position: "fixed",
        bottom: 0,
        left: "50%",
        transform: "translateX(-50%)",
        width: "100%",
        maxWidth: 430,
        background: "rgba(0,0,0,0.98)",
        backdropFilter: "blur(16px)",
        borderTop: "2px solid #ffffff",
        display: "flex",
        padding: "8px 0 calc(8px + env(safe-area-inset-bottom, 0px))",
        zIndex: 100,
      }}
    >
      {tabs.map((tab) => {
        const Icon = icons[tab.id]
        const isActive = activePage === tab.id
        return (
          <button
            key={tab.id}
            onClick={() => onNavigate(tab.id)}
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 3,
              padding: "4px 0",
              background: "none",
              border: "none",
              cursor: "pointer",
              transition: "opacity 0.15s",
            }}
          >
            <Icon active={isActive} />
            <span
              style={{
                fontSize: 9,
                fontFamily: font.mono,
                fontWeight: isActive ? 700 : 400,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: isActive ? color.red : color.ink4,
                transition: "color 0.15s",
              }}
            >
              {tab.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}
