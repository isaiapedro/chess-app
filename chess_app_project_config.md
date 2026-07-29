---
project_name: "Chess Wrapped Analytics Mobile App"
version: "1.0.0"
status: "Planning & Architecture"
architecture:
  backend: "FastAPI (Python)"
  frontend: "React Native (TypeScript) or Flutter (Dart)"
  caching: "Redis (Server) / SQLite (Local Mobile)"
  external_apis: ["Lichess API", "Chess.com API", "Lichess Cloud Eval"]
---

# ♟️ Project Configuration & Build Plan: Chess Analytics App

This document serves as the master configuration and execution blueprint for transforming the existing Python analytical scripts into a fully functional, cross-platform mobile application.

---

## 🏗️ 1. System Architecture

The project shifts from a monolithic Streamlit application to a **Client-Server Architecture**. 

* **Backend (Python / FastAPI):** Reuses the existing `load_data.py`, `stats.py`, and `cache.py` logic. It will act as a REST API that fetches, processes, and serves JSON data to the mobile client.
* **Frontend (Mobile App):** A React Native or Flutter application responsible for rendering the UI, navigating between tabs, providing date-picker filters, and hosting the interactive chessboard.
* **Local Storage:** The mobile app will cache parsed game data locally to ensure instant load times and offline accessibility for previously fetched data.

---

## 📱 2. Core Feature Specifications

### 2.1. Global Filter Header
* **UI/UX:** A sticky navigation bar present across all tabs. 
* **Controls:** Allows sorting content by timestamps (`Year`, `Month`, `Week`, `Day`, `Custom`). 
* **Behavior:** Selecting `Custom` opens a native mobile calendar picker. Changing this filter globally updates the state and re-fetches or re-filters data for all tabs.

### 2.2. Tab 1: Recap (The "Wrapped" Experience)
* **Overview:** High-level overview of time spent, moves made, peak hours, and Elo progression.
* **Comparisons:** Converts play time/moves into fun real-world metrics (e.g., *Number of books read*, *Movies watched*, *Distance walked*).
* **Archetypes:** Displays badges calculated from playstyles (e.g., *Giant Killer*, *Night Owl*).

### 2.3. Tab 2: Insights (Deep Analytics)
* **Overview:** Highlights the most impactful anomalies that lead to wins or losses compared to Lichess population benchmarks.
* **Deep Dive Panels:**
  * Opens a new window with a search bar and four primary module cards:
    1. **Style of Play:** Aggression metrics, first blood rates, clock usage.
    2. **Openings:** Win rates and volume broken down by ECO codes.
    3. **Middlegames:** Early queen trades, tactical piece captures (bishops/knights).
    4. **Endgames:** Marathon vs. Sprint games, specific endgame types reached.

### 2.4. Tab 3: Study (Interactive Improvement)
* **Crucial Mistakes:** Highlights the single move that tanked the game's evaluation (using `Lichess Cloud Eval` API).
* **Opening Repertoire Builder:** 
  * Allows selecting a main opening (or searching for a new one).
  * Cross-references user games against the Lichess Masters Database and population frequencies.
  * Challenges the user on their mistakes: *"What is the best move here?"* and provides strategic commentary.

---

## 🚀 3. Step-by-Step Build Plan

### Step 1: Backend API Development (FastAPI)
* **Objective:** Decouple Python logic from the UI.
* **Tasks:**
  1. Initialize a FastAPI project.
  2. Map `load_data.py` functions to an endpoint: `GET /api/v1/games/{username}?platform={platform}`.
  3. Map `stats.py` outputs to dedicated endpoints:
     * `GET /api/v1/stats/recap`
     * `GET /api/v1/stats/insights`
  4. Ensure `cache.py` uses Redis or a persistent backend cache to avoid rate-limiting from Chess.com/Lichess.

### Step 2: Mobile UI Setup & Routing
* **Objective:** Scaffold the mobile app.
* **Tasks:**
  1. Initialize a React Native (Expo) or Flutter project.
  2. Setup Bottom Tab Navigation (Recap | Insights | Study).
  3. Create the Global Filter Context/Provider so that changing the date globally filters the data provided to the tabs.
  4. Build the UI components for the "Recap" cards and badges.

### Step 3: Interactive Chessboard & Study Tools
* **Objective:** Implement the interactive elements for the Study tab.
* **Tasks:**
  1. Integrate a mobile chessboard component (e.g., `react-native-chessboard`).
  2. Connect the Lichess Explorer and Cloud Eval APIs to feed FEN states to the board.
  3. Build the quiz logic: Pause the board at a critical mistake, accept user input, validate against the engine's best move, and display the strategic comment.

### Step 4: Polish, Caching & Animation
* **Objective:** Make the app feel native and responsive.
* **Tasks:**
  1. Implement local mobile caching (SQLite or AsyncStorage) to store the user's fetched games.
  2. Add charting libraries (e.g., `react-native-chart-kit`) to replace Matplotlib static charts with smooth, animated line/donut charts.
  3. Style with a dark-mode theme to match the existing desktop dashboard aesthetics.

---

## 🔌 4. Required Dependency Migrations

When moving from the current `requirements.txt` to the mobile stack:

**Keep in Python Backend:**
* `fastapi`, `uvicorn` (Replacing Streamlit)
* `python-chess` (For PGN/board parsing)
* `pandas` (For statistical aggregations)
* `requests` (For external API fetching)

**Add to Mobile Frontend (React Native example):**
* `@react-navigation/bottom-tabs`
* `react-native-chessboard`
* `chess.js` (For lightweight frontend move validation)
* `react-native-chart-kit` (For UI visualizations)
