export const playerStats = {
  username: "GrandmasterDark",
  totalGames: 847,
  wins: 491,
  losses: 258,
  draws: 98,
  winRate: 58.0,
  timeSpentHours: 312,
  timeSpentMinutes: 47,
  totalMoves: 24891,
  avgGameLength: 29.4,
  ratingChange: 187,
  currentRating: 1847,
  peakRating: 1891,
  longestWinStreak: 12,
  peakHour: 22,
  gamesAfter9pmPct: 67,
}

export const monthlyActivity = [
  { month: "J", games: 42, wins: 24, rating: 1660 },
  { month: "F", games: 67, wins: 38, rating: 1692 },
  { month: "M", games: 89, wins: 52, rating: 1714 },
  { month: "A", games: 76, wins: 44, rating: 1731 },
  { month: "M", games: 95, wins: 55, rating: 1748 },
  { month: "J", games: 103, wins: 60, rating: 1769 },
  { month: "J", games: 88, wins: 51, rating: 1782 },
  { month: "A", games: 72, wins: 42, rating: 1800 },
  { month: "S", games: 64, wins: 37, rating: 1813 },
  { month: "O", games: 71, wins: 41, rating: 1831 },
  { month: "N", games: 58, wins: 34, rating: 1841 },
  { month: "D", games: 22, wins: 13, rating: 1847 },
]

export const hourlyActivity = [
  { hour: "6", games: 8 }, { hour: "8", games: 14 }, { hour: "10", games: 22 },
  { hour: "12", games: 31 }, { hour: "14", games: 28 }, { hour: "16", games: 35 },
  { hour: "18", games: 52 }, { hour: "20", games: 78 }, { hour: "22", games: 94 },
  { hour: "0", games: 61 }, { hour: "2", games: 29 },
]

export const archetypes = [
  { name: "Giant Killer", desc: "Won 23 games vs opponents rated 200+ above", color: "#ede7d3", symbol: "⚔" },
  { name: "Night Owl", desc: "67% of games played after 9 PM", color: "#0084d2", symbol: "◐" },
  { name: "Tactician", desc: "Top 8% in tactical accuracy this period", color: "#A5CEC7", symbol: "◆" },
  { name: "Endgame Artist", desc: "Converted 89% of winning endgame positions", color: "#D32531", symbol: "♚" },
]

export const comparisons = [
  { label: "Movies you could have watched", value: 156, icon: "▶" },
  { label: "Books you could have finished", value: 24, icon: "▣" },
  { label: "Hours of sleep missed", value: 312, icon: "◑" },
  { label: "Espresso shots consumed", value: 624, icon: "●" },
]

export const winFactors = [
  {
    name: "Endgame Accuracy",
    value: "74%",
    avg: "68%",
    delta: "+6%",
    positive: true,
    description: "Your technique in endgames is significantly above the platform average. You rarely let winning positions slip.",
    chartData: [62, 65, 68, 69, 72, 71, 74],
  },
  {
    name: "First Blood Conversion",
    value: "61%",
    avg: "54%",
    delta: "+7%",
    positive: true,
    description: "When you win material first, you convert at a near-elite rate. Opponents struggle to hold against your technique.",
    chartData: [48, 51, 53, 55, 57, 59, 61],
  },
  {
    name: "Clock Management",
    value: "1.8s/move",
    avg: "2.4s/move",
    delta: "-0.6s",
    positive: true,
    description: "You use 25% less time per move than average, creating psychological pressure in the final minutes.",
    chartData: [2.6, 2.5, 2.4, 2.3, 2.1, 1.9, 1.8],
  },
]

export const lossFactors = [
  {
    name: "Opening Blunder Rate",
    value: "8.2%",
    avg: "5.1%",
    delta: "+3.1%",
    positive: false,
    description: "You blunder significantly more in the first 10 moves than average. Preparation gaps are costing games early.",
    chartData: [5.4, 5.8, 6.2, 6.9, 7.3, 7.8, 8.2],
  },
  {
    name: "Knight vs Bishop",
    value: "31% WR",
    avg: "44% WR",
    delta: "-13%",
    positive: false,
    description: "When you have a knight against an opposing bishop in open positions, your win rate drops sharply.",
    chartData: [46, 44, 43, 40, 38, 34, 31],
  },
  {
    name: "Passed Pawn Defense",
    value: "38% WR",
    avg: "52% WR",
    delta: "-14%",
    positive: false,
    description: "Defending passed pawns is a critical weakness. Opponents with passed pawns win at a disproportionate rate.",
    chartData: [54, 52, 50, 47, 44, 41, 38],
  },
]

export const catalogSections = {
  style: {
    title: "Style of Play",
    icon: "♞",
    color: "#0084d2",
    metrics: [
      { name: "Aggression Index", value: 72, avg: 58, unit: "/100", desc: "Tendency to maintain aggressive piece placement" },
      { name: "First Blood Rate", value: 61, avg: 54, unit: "%", desc: "How often you capture the first piece in a game" },
      { name: "Avg Piece Mobility", value: 8.4, avg: 7.1, unit: " sq", desc: "Average available squares per piece mid-game" },
      { name: "Clock Usage", value: 68, avg: 74, unit: "%", desc: "Percentage of allotted time used on average" },
      { name: "Exchanges Per Game", value: 2.3, avg: 2.8, unit: "x", desc: "Piece trades initiated per game" },
    ],
  },
  openings: {
    title: "Openings",
    icon: "♛",
    color: "#ede7d3",
    metrics: [
      { name: "Sicilian Defense", value: 68, avg: 52, unit: "%", desc: "Win rate · 68 games · ECO B20–B99" },
      { name: "Italian Game", value: 54, avg: 56, unit: "%", desc: "Win rate · 112 games · ECO C50–C59" },
      { name: "Queens Gambit", value: 71, avg: 55, unit: "%", desc: "Win rate · 43 games · ECO D06–D69" },
      { name: "Kings Indian Def.", value: 42, avg: 48, unit: "%", desc: "Win rate · 31 games · ECO E60–E99" },
      { name: "Ruy Lopez", value: 63, avg: 58, unit: "%", desc: "Win rate · 89 games · ECO C60–C99" },
    ],
  },
  middlegame: {
    title: "Middlegames",
    icon: "♝",
    color: "#A5CEC7",
    metrics: [
      { name: "Tactical Accuracy", value: 79, avg: 71, unit: "%", desc: "Percentage of tactical opportunities found" },
      { name: "Early Queen Trade", value: 34, avg: 28, unit: "%", desc: "Games with queens exchanged before move 20" },
      { name: "Knight Sacrifice Rate", value: 8.2, avg: 4.1, unit: "%", desc: "How often you sacrifice a knight for compensation" },
      { name: "Pawn Structure Score", value: 6.8, avg: 6.2, unit: "/10", desc: "Average pawn structure quality assessed by engine" },
      { name: "Piece Coordination", value: 74, avg: 65, unit: "/100", desc: "How well your pieces work in concert" },
    ],
  },
  endgame: {
    title: "Endgames",
    icon: "♚",
    color: "#D32531",
    metrics: [
      { name: "Endgame Conversion", value: 89, avg: 74, unit: "%", desc: "Won positions successfully converted to a full point" },
      { name: "Rook Endgame WR", value: 71, avg: 62, unit: "%", desc: "Win rate in rook vs rook endgame structures" },
      { name: "Pawn Endgame WR", value: 64, avg: 58, unit: "%", desc: "Win rate in king and pawn endgames" },
      { name: "Marathon Games", value: 18, avg: 12, unit: "%", desc: "Games lasting 60 or more moves" },
      { name: "Sprint Decisions", value: 31, avg: 24, unit: "%", desc: "Games decided in under 30 moves" },
    ],
  },
}

export const mistakePositions = [
  {
    id: 1,
    date: "Nov 23, 2024",
    opponent: "Magnus_fan2023",
    opponentRating: 1891,
    result: "loss" as const,
    moveNumber: 24,
    fen: "r1bq1rk1/pp2ppbp/2n2np1/3p4/3P4/2NBPN2/PP3PPP/R1BQ1RK1 w - - 0 24",
    yourMove: "Nb5?",
    bestMove: "c4!",
    evalBefore: "+0.3",
    evalAfter: "-1.8",
    evalDrop: -2.1,
    commentary: "Nb5 looks aggressive but can be immediately chased by ...a6, leaving your knight misplaced. The correct plan is c4, striking at the center and maintaining your structural advantage. After Nb5 a6 Nc3 d4, Black seizes the initiative.",
    highlights: [
      { row: 3, col: 1, type: "mistake" as const },
      { row: 4, col: 2, type: "best" as const },
    ],
  },
  {
    id: 2,
    date: "Nov 21, 2024",
    opponent: "TacticalBishop",
    opponentRating: 1762,
    result: "loss" as const,
    moveNumber: 18,
    fen: "r2qkb1r/ppp2ppp/2n1bn2/3pp3/2B1P3/2NP1N2/PPP2PPP/R1BQK2R w KQkq - 0 18",
    yourMove: "Bg5?",
    bestMove: "d4!",
    evalBefore: "0.0",
    evalAfter: "-2.1",
    evalDrop: -2.1,
    commentary: "Bg5 pins the knight but overlooks ...exd4 followed by ...d4, winning a piece. The move d4 challenges the center immediately, forcing Black to decide how to defend. This is the critical moment where the opening transitions to the middlegame.",
    highlights: [
      { row: 2, col: 6, type: "mistake" as const },
      { row: 4, col: 3, type: "best" as const },
    ],
  },
  {
    id: 3,
    date: "Nov 19, 2024",
    opponent: "Endgame_Specialist",
    opponentRating: 1923,
    result: "loss" as const,
    moveNumber: 31,
    fen: "8/5pk1/6p1/p1p5/Pp6/1P3KPP/8/8 w - - 0 31",
    yourMove: "Kf4?",
    bestMove: "g4!",
    evalBefore: "0.0",
    evalAfter: "-3.2",
    evalDrop: -3.2,
    commentary: "Kf4 walks into a losing king and pawn endgame. After ...g5+, Black gains a decisive outside passed pawn. The correct move is g4, creating kingside counterplay. The principle here: in equal pawn endgames, activity wins.",
    highlights: [
      { row: 4, col: 5, type: "mistake" as const },
      { row: 5, col: 6, type: "best" as const },
    ],
  },
]

export const openingPositions = [
  {
    id: 1,
    name: "Sicilian: Najdorf Variation",
    eco: "B90",
    gamesPlayed: 34,
    winRate: 68,
    fen: "rnbqkb1r/1p2pppp/p2p1n2/8/3NP3/2N5/PPP2PPP/R1BQKB1R w KQkq - 0 7",
    question: "White to move — what is the main continuation?",
    bestMove: "Bg5",
    alternatives: ["f4", "Be3", "Bc4"],
    commentary: "Bg5 is the Classical Najdorf, pinning the f6 knight and preparing f4. This is Kasparov's weapon — aggressive and rich in theory. Be3 is the English Attack (also strong), but Bg5 demands precise knowledge from Black immediately.",
    highlights: [
      { row: 2, col: 6, type: "best" as const },
    ],
  },
  {
    id: 2,
    name: "Italian Game: Giuoco Piano",
    eco: "C54",
    gamesPlayed: 67,
    winRate: 54,
    fen: "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQK2R b KQkq - 0 5",
    question: "Black to move — what is the most principled response?",
    bestMove: "d6",
    alternatives: ["a6", "O-O", "d5"],
    commentary: "d6 prepares Be6, developing the bishop to a solid square and controlling the center. d5 is more ambitious and leads to sharp play, but requires precise calculation. The quiet d6 keeps a solid structure while completing development.",
    highlights: [
      { row: 4, col: 3, type: "best" as const },
    ],
  },
]
