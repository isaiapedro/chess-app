# Visual Identity & Design System Manual

This manual documents the design language, color palette, typography hierarchy, UI patterns, and interactive micro-physics defined across the codebase.

---

## 1. Design Philosophy & Overview

The visual identity blends **Editorial Elegance**, **Neo-Brutalism**, and **Analog Skeuomorphism**:
* **Dark Editorial Base:** Rich dark backdrops (`#000000`, `#0d0d0d`) paired with high-contrast serif headers and crisp monochrome text.
* **Analog / Desk Aesthetic:** Paper textures, grain noise filters, subtle card rotations (`-1deg` to `3deg`), polaroid image frames, paperclips, and frosted scotch tape.
* **Neo-Brutalist Controls:** Bold action buttons featuring thick borders, hard multi-layered box shadows (`0px 0px 0px 2px white, 0px 5px 0px 2px #6D7876`), and stark red focal points.
* **Dual-Theme Engine:** Fully responsive dark and light mode (`.light-theme` with `#f5f5f0` base color) adapting card contrast, typography, and line colors.

---

## 2. Color System

### Primary & Accent Colors

| Color Role | Hex / Value | Context & Application |
| :--- | :--- | :--- |
| **Brand Red (Primary)** | `#D32531` | Main action buttons, active filters, section highlights |
| **Hover Red** | `#a0000f` | Button hover states, active filter rectangles |
| **Heart / Like Red** | `#FF5A5A` / `#ff4d4d` | Active like buttons, heart badges, underline accents |
| **Sage / Teal Accent** | `#A5CEC7` | Search focus borders, active grid borders, back links |
| **Rating Blue** | `#0084d2` | Conic-gradient rating circle gauge, title hover states |
| **Success Toast** | `#7cfc7c` | "Copied to clipboard" feedback text |

### Paper & Skeuomorphic Tones

| Color Tone | Hex / Value | Application |
| :--- | :--- | :--- |
| **Vintage Cream Paper** | `#ede7d3` / `#ede4d3` | Bio card background, project note background |
| **Paper Shadow Tint** | `#d8d0b8` | Right-side shadow gradient on curling paper |
| **Frosted Tape** | `rgba(255, 255, 255, 0.4)` | Scotch tape background overlay with `blur(2px)` |

### Neutrals (Dark Theme Default)

| Tone | Hex / Value | Application |
| :--- | :--- | :--- |
| **Absolute Black** | `#000000` | Global body background, dark button active states |
| **Deep Charcoal** | `#0d0d0d` | Page background radial gradient center |
| **Card Dark** | `#1a1a1a` / `#1d1d1d` | Scores, preview panes, floating menus |
| **Muted Dark** | `#222222` / `#2b2b2b` | Code blocks, admin replies, blockquotes |
| **Borders & Dividers** | `#333333` / `rgba(255,255,255,0.08)` | Card outlines, row separators |
| **Subtle Text** | `#888888` / `#aaaaaa` | Metadata, project technologies, audio labels |
| **Off-White / White** | `#e0e0e0` / `#ffffff` | Primary body text, titles, contrast borders |

### Light Theme System (`.light-theme`)

| Role | Hex / Value | Notes |
| :--- | :--- | :--- |
| **Background** | `#f5f5f0` | Off-white canvas across all containers |
| **Primary Text** | `#111111` | High contrast headers, titles, and body text |
| **Secondary Text** | `#444444` / `#555555` | Subtitles, meta-data, dates |
| **Card Background** | `rgba(0, 0, 0, 0.03)` / `#ebebeb` | Muted translucent dark-on-light cards |
| **Code Block Bg** | `#e8e4dd` / `#e2ddd6` | Warm grey code container |

---

## 3. Typography Hierarchy

### Font Families

* **Serif (Editorial Titles & Headings):** `'Playfair Display', serif`
* **Sans-Serif (Body & UI Text):** `'Inter', sans-serif`, `'Helvetica', sans-serif`
* **Monospace (Code, Metadata & Technical Details):** `'IBM Plex Mono', monospace`, `'Courier New'`
* **Typewriter (Skeuomorphic Labels):** `'Special Elite', monospace`
* **Handwriting & Scripts:** `'Shadows Into Light', cursive`, `'Dancing Script'`, `'Homemade Apple'`, `'La Belle Aurore'`

### Typography Scales & Styling Rules

├── Large Titles / Section Titles
│   ├── Font: Playfair Display
│   ├── Size: 3.1rem – 3.5rem (Desktop) / 2.0rem – 2.2rem (Mobile)
│   └── Color: #FFFFFF (Dark) / #111111 (Light)
│
├── Subtitles / Section Headers
│   ├── Font: Playfair Display / Inter / Special Elite
│   ├── Size: 1.5rem – 3.0rem
│   └── Weight: 500 – 600
│
├── Article / Card Titles
│   ├── Font: IBM Plex Mono (Lowercase) OR Playfair Display
│   ├── Size: 1.1rem – 1.8rem
│   └── Weight: 500 – Bold
│
├── Body Copy
│   ├── Longform Body: Playfair Display / Inter (1.05rem – 1.25rem, line-height: 1.7 – 1.8)
│   └── Card Descriptions: Sans-serif (0.95rem – 1.3rem, line-height: 1.4 – 1.6)
│
└── Metadata & Technical Details
├── Font: IBM Plex Mono / Helvetica
├── Size: 0.85rem – 1.18rem
└── Case: Monospace lowercase or uppercase tags

---

## 4. UI Patterns & Components

### A. Neo-Brutalist Buttons

Bold, elevated buttons with multi-layered offset shadows:

```css
.show-more-btn, .filter-rect {
  padding: 14px 35px;
  color: white;
  font-weight: bold;
  text-transform: uppercase;
  background-color: #D32531;
  border: 1px solid black;
  box-shadow: 0px 0px 0px 2px white, 0px 5px 0px 2px #6D7876;
}
```

### B. Tactile Paper Cards & Polaroid Frames

Skeuomorphic cards featuring noise textures, slight tilt transforms, and organic border radii:

    Bio Card Shape: border-radius: 0px 2px 225px 225px / 255px 225px 5px 0px; with transform: rotate(-1deg);

    Noise Overlay: Inline SVG fractal noise filters (feTurbulence) applied over warm cream backgrounds (#ede7d3).

    Polaroid Frame: White border wrapper with soft shadow (box-shadow: 0 5px 8px rgba(0,0,0,0.25)), sepia filter (filter: sepia(0.15) contrast(1.05)), and slight rotation (transform: rotate(-2.7deg)).

    Frosted Scotch Tape Accent:

    ```CSS

    .tape {
      position: absolute;
      top: -20px;
      left: 50%;
      transform: translateX(-50%) rotate(-3deg);
      width: 170px;
      height: 50px;
      background-color: rgba(255, 255, 255, 0.4);
      backdrop-filter: blur(2px);
      border-radius: 2px;
    }
    ```

### C. Search Bar & Inputs

Floating rounded search inputs with subtle glassmorphism:

    Border Radius: 30px (Pill format) or 20px

    Background: rgba(240, 240, 240, 0.8) with backdrop-filter: blur(4px)

    Focus State: Rings with sage teal #A5CEC7 or high-contrast box shadows.

### D. Conic Score Dial Component

A circular rating widget constructed with native CSS gradients:

    Gauge Outer Ring: background: conic-gradient(#0084d2 var(--percentage), rgba(255, 255, 255, 0.1) 0);

    Center Cutout: Masked with an inset: 8px pseudo-element matching the background color (#1d1d1d).

### E. Tags & Micro-Pills

    Genre Pills: Monospace font, border-radius: 16px, subtle background rgba(255,255,255,0.08), border 1px solid #333.

    Meta Tags: Square rounded corners (border-radius: 4px), high contrast inversion on hover.

## 5. Micro-Interactions & Physics
### 1. 3D Paper Curl & Rip Hover Effect

Hovering over list items simulates curling paper in 3D space:

```CSS

.project-list {
  perspective: 800px;
}

.project-item:hover {
  transform: rotateY(15deg) translateX(-15px) skewY(-1deg);
  background: linear-gradient(to right, #ede4d3 80%, #d8d0b8 100%);
  box-shadow: 15px 10px 15px rgba(0,0,0,0.15);
  border-bottom-color: transparent;
}
```

### 2. Loading Shimmer Skeleton

Image loading skeleton effect using animated linear gradients:


```CSS

@keyframes shimmer {
  0%   { background-position: -400px 0; }
  100% { background-position:  400px 0; }
}

.img-shimmer {
  background: linear-gradient(90deg, #111 25%, #222 50%, #111 75%);
  background-size: 800px 100%;
  animation: shimmer 1.4s infinite linear;
}
```

### 3. Newspaper Grid & Masonry Layouts

    Newspaper Column Grid: Three-column breakdown (1fr 2fr 1fr) separated by fine structural lines (1px solid rgba(255, 255, 255, 0.2)).

    Masonry Grid: Multi-column layout using native CSS column-count: 4, automatically scaling down to 3, 2, and 1 column on smaller viewports (max-width: 768px).