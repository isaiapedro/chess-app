import AsyncStorage from "@react-native-async-storage/async-storage";
import { Chess } from "chess.js";
import type { QueryFilters } from "../api/client";
import type { Platform, Timeframe } from "../api/types";
import type { StudyGame } from "../engine/analyzeMistakes";
import {
  GAMES_FIRST_PAGE_SIZE,
  GAMES_PAGE_SIZE,
} from "../api/client";
import { takeInflight } from "../storage/cache";

const STORE_PREFIX = "@chess-wrapped:user-games:v1:";
const META_SUFFIX = ":meta";
const GAMES_FETCH_TTL_MS = 24 * 60 * 60 * 1000;

export type PlatformGamesAuth = {
  email?: string | null;
  lichessAccessToken?: string | null;
};

type UserGamesStore = {
  username: string;
  platform: Platform;
  games: Array<Record<string, unknown>>;
  watermark: number;
  coverage_since: number;
  last_fetched_at: number;
};

type UserGamesMeta = {
  last_fetched_at?: number;
  coverage_since?: number;
};

export type NormalizedGame = StudyGame & {
  opp_rating?: number;
  move_count?: number;
  termination?: string;
  opp_termination?: string;
};

let authCreds: PlatformGamesAuth = {};

export function setPlatformGamesAuth(next: PlatformGamesAuth): void {
  authCreds = {
    email: next.email || null,
    lichessAccessToken: next.lichessAccessToken || null,
  };
}

export function getPlatformGamesAuth(): PlatformGamesAuth {
  return authCreds;
}

function safeUsername(username: string): string {
  return username.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "_");
}

function storeKey(platform: Platform, username: string): string {
  return `${STORE_PREFIX}${platform}|${safeUsername(username)}`;
}

function metaKey(platform: Platform, username: string): string {
  return `${storeKey(platform, username)}${META_SUFFIX}`;
}

function chesscomUserAgent(): string {
  const email = (authCreds.email || "dev@example.com").trim();
  return `ChessWrappedMobile/1.0 (contact: ${email})`;
}

async function loadStore(
  platform: Platform,
  username: string
): Promise<UserGamesStore | null> {
  try {
    const raw = await AsyncStorage.getItem(storeKey(platform, username));
    if (!raw) return null;
    const data = JSON.parse(raw) as UserGamesStore;
    if (!data || !Array.isArray(data.games)) return null;
    return data;
  } catch {
    return null;
  }
}

async function loadMeta(
  platform: Platform,
  username: string
): Promise<UserGamesMeta | null> {
  try {
    const raw = await AsyncStorage.getItem(metaKey(platform, username));
    if (!raw) return null;
    const data = JSON.parse(raw) as UserGamesMeta;
    return data && typeof data === "object" ? data : null;
  } catch {
    return null;
  }
}

async function writeMeta(
  platform: Platform,
  username: string,
  patch: UserGamesMeta
): Promise<void> {
  const prior = (await loadMeta(platform, username)) || {};
  const next = { ...prior, ...patch };
  await AsyncStorage.setItem(metaKey(platform, username), JSON.stringify(next));
}

async function saveStore(
  platform: Platform,
  username: string,
  store: Omit<UserGamesStore, "username" | "platform"> &
    Partial<Pick<UserGamesStore, "username" | "platform">>
): Promise<void> {
  const now = Date.now() / 1000;
  const lastFetched = store.last_fetched_at || now;
  const payload: UserGamesStore = {
    username: username.toLowerCase(),
    platform,
    games: store.games || [],
    watermark: store.watermark || 0,
    coverage_since: store.coverage_since || 0,
    last_fetched_at: lastFetched,
  };
  await AsyncStorage.setItem(
    storeKey(platform, username),
    JSON.stringify(payload)
  );
  await writeMeta(platform, username, {
    last_fetched_at: lastFetched,
    coverage_since: payload.coverage_since,
  });
}

function coverageValue(raw: unknown): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

async function coverageSinceOf(
  platform: Platform,
  username: string,
  store: UserGamesStore | null
): Promise<number> {
  const storeCov =
    store && "coverage_since" in store
      ? coverageValue(store.coverage_since)
      : null;
  const meta = await loadMeta(platform, username);
  const metaCov =
    meta && "coverage_since" in meta
      ? coverageValue(meta.coverage_since)
      : null;
  const values = [storeCov, metaCov].filter((v): v is number => v != null);
  if (!values.length) return 0;
  if (values.some((v) => v <= 0)) return 0;
  return Math.min(...values);
}

function coverageCovers(coverageSince: number, requestedSince: number): boolean {
  if (coverageSince <= 0) return true;
  if (requestedSince <= 0) return false;
  return coverageSince <= requestedSince;
}

async function readLastFetchedAt(
  platform: Platform,
  username: string,
  store: UserGamesStore | null
): Promise<number> {
  const meta = await loadMeta(platform, username);
  if (meta) {
    const ts = Number(meta.last_fetched_at || 0);
    if (ts > 0) return ts;
  }
  if (store) {
    const ts = Number(store.last_fetched_at || 0);
    if (ts > 0) return ts;
  }
  return 0;
}

async function storeIsFresh(
  platform: Platform,
  username: string,
  store: UserGamesStore
): Promise<boolean> {
  if (GAMES_FETCH_TTL_MS <= 0) return false;
  const last = await readLastFetchedAt(platform, username, store);
  if (last <= 0) return false;
  return Date.now() / 1000 - last < GAMES_FETCH_TTL_MS / 1000;
}

function mergeGamesById(
  existing: Array<Record<string, unknown>>,
  incoming: Array<Record<string, unknown>>,
  idFn: (g: Record<string, unknown>) => string | null
): Array<Record<string, unknown>> {
  const byId = new Map<string, Record<string, unknown>>();
  for (const game of existing) {
    const key = idFn(game);
    if (key) byId.set(key, game);
  }
  for (const game of incoming) {
    const key = idFn(game);
    if (key) byId.set(key, game);
  }
  return [...byId.values()];
}

function incomingAddsGames(
  existing: Array<Record<string, unknown>>,
  incoming: Array<Record<string, unknown>>,
  idFn: (g: Record<string, unknown>) => string | null
): boolean {
  if (!incoming.length) return false;
  const have = new Set(
    existing.map(idFn).filter((id): id is string => Boolean(id))
  );
  for (const game of incoming) {
    const key = idFn(game);
    if (key && !have.has(key)) return true;
  }
  return false;
}

function gameIdSet(
  games: Array<Record<string, unknown>>,
  idFn: (g: Record<string, unknown>) => string | null
): Set<string> {
  return new Set(
    games.map(idFn).filter((id): id is string => Boolean(id))
  );
}

function lichessGameId(game: Record<string, unknown>): string | null {
  const id = game.id;
  return id != null ? String(id) : null;
}

function lichessGameEndMs(game: Record<string, unknown>): number {
  return Number(game.lastMoveAt || game.createdAt || 0);
}

function chesscomGameId(game: Record<string, unknown>): string | null {
  const url = game.url;
  return url ? String(url) : null;
}

function chesscomGameEnd(game: Record<string, unknown>): number {
  return Number(game.end_time || 0);
}

function sinceForTimeframe(timeframe: Timeframe | string): {
  sinceTimestamp: number;
  sinceMs: number;
} {
  const tf = String(timeframe || "").trim().toLowerCase();
  if (tf === "all" || tf === "lifetime") {
    return { sinceTimestamp: 0, sinceMs: 0 };
  }
  const now = new Date();
  let days = 365;
  if (tf === "1 month") days = 30;
  else if (tf === "6 months") days = 180;
  const start = new Date(now);
  start.setDate(start.getDate() - days);
  start.setHours(0, 0, 0, 0);
  const sinceTimestamp = start.getTime() / 1000;
  return { sinceTimestamp, sinceMs: Math.floor(sinceTimestamp * 1000) };
}

async function fetchLichessApi(
  username: string,
  sinceMs: number
): Promise<Array<Record<string, unknown>> | null> {
  const params = new URLSearchParams({
    opening: "true",
    evals: "false",
    perfType: "bullet,blitz,rapid,classical",
  });
  if (sinceMs > 0) params.set("since", String(sinceMs));
  const headers: Record<string, string> = {
    Accept: "application/x-ndjson",
  };
  if (authCreds.lichessAccessToken) {
    headers.Authorization = `Bearer ${authCreds.lichessAccessToken}`;
  }
  const res = await fetch(
    `https://lichess.org/api/games/user/${encodeURIComponent(username)}?${params}`,
    { headers }
  );
  if (!res.ok) return null;
  const text = (await res.text()).trim();
  if (!text) return [];
  const games: Array<Record<string, unknown>> = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    try {
      games.push(JSON.parse(line) as Record<string, unknown>);
    } catch {
      void 0;
    }
  }
  return games;
}

function filterLichessSince(
  games: Array<Record<string, unknown>>,
  sinceMs: number
): Array<Record<string, unknown>> {
  if (sinceMs <= 0) return games;
  return games.filter((g) => lichessGameEndMs(g) >= sinceMs);
}

async function fetchLichessGamesRaw(
  username: string,
  sinceMs = 0,
  force = false
): Promise<Array<Record<string, unknown>>> {
  const platform: Platform = "lichess";
  let store = await loadStore(platform, username);
  if (store && !force) {
    const covers = coverageCovers(
      await coverageSinceOf(platform, username, store),
      sinceMs
    );
    if (covers && (await storeIsFresh(platform, username, store))) {
      return filterLichessSince(store.games || [], sinceMs);
    }
  }

  if (!store) {
    const fetchSince = Math.max(0, Math.floor(sinceMs));
    const fetched = await fetchLichessApi(username, fetchSince);
    if (fetched == null) return [];
    const existing = await loadStore(platform, username);
    let games: Array<Record<string, unknown>>;
    let coverageSince: number;
    if (existing) {
      games = mergeGamesById(existing.games || [], fetched, lichessGameId);
      const prior = await coverageSinceOf(platform, username, existing);
      coverageSince =
        prior <= 0 || fetchSince <= 0 ? 0 : Math.min(prior, fetchSince);
    } else {
      games = fetched;
      coverageSince = fetchSince;
    }
    const watermark = Math.max(0, ...games.map(lichessGameEndMs));
    await saveStore(platform, username, {
      games,
      watermark,
      coverage_since: coverageSince,
      last_fetched_at: Date.now() / 1000,
    });
    return filterLichessSince(games, sinceMs);
  }

  const covers = coverageCovers(
    await coverageSinceOf(platform, username, store),
    sinceMs
  );
  if (!covers) {
    const fetchSince = Math.max(0, Math.floor(sinceMs));
    const incoming = await fetchLichessApi(username, fetchSince);
    const existing = (await loadStore(platform, username)) || store;
    let games = existing.games || [];
    if (incoming == null) return filterLichessSince(games, sinceMs);
    const prior = await coverageSinceOf(platform, username, existing);
    const coverageSince =
      prior <= 0 || fetchSince <= 0 ? 0 : Math.min(prior, fetchSince);
    if (!incomingAddsGames(games, incoming, lichessGameId)) {
      await writeMeta(platform, username, {
        last_fetched_at: Date.now() / 1000,
        coverage_since: coverageSince,
      });
      return filterLichessSince(games, sinceMs);
    }
    games = mergeGamesById(games, incoming, lichessGameId);
    const watermark = Math.max(0, ...games.map(lichessGameEndMs));
    await saveStore(platform, username, {
      games,
      watermark,
      coverage_since: coverageSince,
      last_fetched_at: Date.now() / 1000,
    });
    return filterLichessSince(games, sinceMs);
  }

  const watermark = Number(store.watermark || 0);
  const incoming = await fetchLichessApi(username, watermark);
  const existing = (await loadStore(platform, username)) || store;
  let games = existing.games || [];
  if (incoming == null) return filterLichessSince(games, sinceMs);
  if (!incomingAddsGames(games, incoming, lichessGameId)) {
    await writeMeta(platform, username, {
      last_fetched_at: Date.now() / 1000,
    });
    return filterLichessSince(games, sinceMs);
  }
  games = mergeGamesById(games, incoming, lichessGameId);
  const nextWm = Math.max(
    Number(existing.watermark || 0),
    Math.max(0, ...games.map(lichessGameEndMs))
  );
  await saveStore(platform, username, {
    games,
    watermark: nextWm,
    coverage_since: await coverageSinceOf(platform, username, existing),
    last_fetched_at: Date.now() / 1000,
  });
  return filterLichessSince(games, sinceMs);
}

function archiveYearMonth(
  archiveUrl: string
): { year: number; month: number } | null {
  const match = archiveUrl.match(/\/(\d{4})\/(\d{2})\/?$/);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]) };
}

function archiveSealedAt(archiveUrl: string): number | null {
  const parsed = archiveYearMonth(archiveUrl);
  if (!parsed) return null;
  const { year, month } = parsed;
  const next =
    month === 12
      ? new Date(year + 1, 0, 1)
      : new Date(year, month, 1);
  return next.getTime() / 1000;
}

function chesscomArchiveUrl(
  username: string,
  year: number,
  month: number
): string {
  return `https://api.chess.com/pub/player/${username.toLowerCase()}/games/${year}/${String(month).padStart(2, "0")}`;
}

async function chesscomListArchives(username: string): Promise<string[]> {
  const res = await fetch(
    `https://api.chess.com/pub/player/${username.toLowerCase()}/games/archives`,
    { headers: { "User-Agent": chesscomUserAgent() } }
  );
  if (!res.ok) return [];
  const body = (await res.json()) as { archives?: string[] };
  return body.archives || [];
}

function archivesOverlappingSince(
  archives: string[],
  sinceTimestamp: number
): string[] {
  if (sinceTimestamp <= 0) return [...archives];
  return archives.filter((url) => {
    const sealed = archiveSealedAt(url);
    return sealed != null && sealed > sinceTimestamp;
  });
}

async function fetchChesscomArchive(
  archiveUrl: string
): Promise<Array<Record<string, unknown>>> {
  const res = await fetch(archiveUrl, {
    headers: { "User-Agent": chesscomUserAgent() },
  });
  if (!res.ok) return [];
  const body = (await res.json()) as { games?: Array<Record<string, unknown>> };
  return body.games || [];
}

async function fetchChesscomArchives(
  archives: string[]
): Promise<Array<Record<string, unknown>>> {
  const fetched: Array<Record<string, unknown>> = [];
  for (const url of archives) {
    fetched.push(...(await fetchChesscomArchive(url)));
  }
  return mergeGamesById([], fetched, chesscomGameId);
}

async function chesscomRefreshHead(
  username: string,
  games: Array<Record<string, unknown>>
): Promise<Array<Record<string, unknown>>> {
  const now = new Date();
  const currentUrl = chesscomArchiveUrl(username, now.getFullYear(), now.getMonth() + 1);
  const headGames = await fetchChesscomArchive(currentUrl);
  const prevMonth = now.getMonth() === 0 ? 12 : now.getMonth();
  const prevYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const prevUrl = chesscomArchiveUrl(username, prevYear, prevMonth);
  const prevGames = await fetchChesscomArchive(prevUrl);
  const headMonths = new Set([
    `${now.getFullYear()}-${now.getMonth() + 1}`,
    `${prevYear}-${prevMonth}`,
  ]);
  const retained = games.filter((game) => {
    const end = chesscomGameEnd(game);
    if (end <= 0) return true;
    const dt = new Date(end * 1000);
    return !headMonths.has(`${dt.getFullYear()}-${dt.getMonth() + 1}`);
  });
  return mergeGamesById(retained, [...prevGames, ...headGames], chesscomGameId);
}

function filterChesscomSince(
  games: Array<Record<string, unknown>>,
  sinceTimestamp: number
): Array<Record<string, unknown>> {
  if (sinceTimestamp <= 0) return games;
  return games.filter((g) => chesscomGameEnd(g) >= sinceTimestamp);
}

async function mergedCoverageSince(
  platform: Platform,
  username: string,
  store: UserGamesStore | null,
  fetchSince: number
): Promise<number> {
  const prior = await coverageSinceOf(platform, username, store);
  if (prior <= 0 || fetchSince <= 0) return 0;
  return Math.min(prior, fetchSince);
}

async function fetchChesscomGamesRaw(
  username: string,
  sinceTimestamp = 0,
  force = false
): Promise<Array<Record<string, unknown>>> {
  const platform: Platform = "chesscom";
  let store = await loadStore(platform, username);
  if (store && !force) {
    const covers = coverageCovers(
      await coverageSinceOf(platform, username, store),
      sinceTimestamp
    );
    if (covers && (await storeIsFresh(platform, username, store))) {
      return filterChesscomSince(store.games || [], sinceTimestamp);
    }
  }

  if (!store) {
    const archives = archivesOverlappingSince(
      await chesscomListArchives(username),
      sinceTimestamp
    );
    if (!archives.length) return [];
    const fetched = await fetchChesscomArchives(archives);
    const existing = await loadStore(platform, username);
    let games: Array<Record<string, unknown>>;
    let coverageSince: number;
    if (existing) {
      games = mergeGamesById(existing.games || [], fetched, chesscomGameId);
      coverageSince = await mergedCoverageSince(
        platform,
        username,
        existing,
        sinceTimestamp
      );
    } else {
      games = fetched;
      coverageSince = Math.max(0, sinceTimestamp);
    }
    const watermark = Math.max(0, ...games.map(chesscomGameEnd));
    await saveStore(platform, username, {
      games,
      watermark,
      coverage_since: coverageSince,
      last_fetched_at: Date.now() / 1000,
    });
    return filterChesscomSince(games, sinceTimestamp);
  }

  const covers = coverageCovers(
    await coverageSinceOf(platform, username, store),
    sinceTimestamp
  );
  if (!covers) {
    const archives = archivesOverlappingSince(
      await chesscomListArchives(username),
      sinceTimestamp
    );
    const fetched = archives.length
      ? await fetchChesscomArchives(archives)
      : [];
    const existing = (await loadStore(platform, username)) || store;
    let games = existing.games || [];
    const coverageSince = await mergedCoverageSince(
      platform,
      username,
      existing,
      sinceTimestamp
    );
    if (!incomingAddsGames(games, fetched, chesscomGameId)) {
      await writeMeta(platform, username, {
        last_fetched_at: Date.now() / 1000,
        coverage_since: coverageSince,
      });
      return filterChesscomSince(games, sinceTimestamp);
    }
    games = mergeGamesById(games, fetched, chesscomGameId);
    const watermark = Math.max(0, ...games.map(chesscomGameEnd));
    await saveStore(platform, username, {
      games,
      watermark,
      coverage_since: coverageSince,
      last_fetched_at: Date.now() / 1000,
    });
    return filterChesscomSince(games, sinceTimestamp);
  }

  const refreshed = await chesscomRefreshHead(username, store.games || []);
  const existing = (await loadStore(platform, username)) || store;
  const priorGames = existing.games || [];
  const games = mergeGamesById(priorGames, refreshed, chesscomGameId);
  const same =
    [...gameIdSet(games, chesscomGameId)].sort().join("|") ===
    [...gameIdSet(priorGames, chesscomGameId)].sort().join("|");
  if (same) {
    await writeMeta(platform, username, {
      last_fetched_at: Date.now() / 1000,
    });
    return filterChesscomSince(priorGames, sinceTimestamp);
  }
  const watermark = Math.max(0, ...games.map(chesscomGameEnd));
  await saveStore(platform, username, {
    games,
    watermark,
    coverage_since: await coverageSinceOf(platform, username, existing),
    last_fetched_at: Date.now() / 1000,
  });
  return filterChesscomSince(games, sinceTimestamp);
}

function movesFromPgn(pgnStr: string): string {
  if (!pgnStr?.trim()) return "";
  try {
    const chess = new Chess();
    chess.loadPgn(pgnStr);
    return chess.history().join(" ");
  } catch {
    return "";
  }
}

function toIso(tsSecondsOrMs: number): string {
  if (!tsSecondsOrMs) return new Date(0).toISOString();
  const ms = tsSecondsOrMs > 1e12 ? tsSecondsOrMs : tsSecondsOrMs * 1000;
  return new Date(ms).toISOString();
}

function parseLichessGames(
  rawGames: Array<Record<string, unknown>>,
  username: string
): NormalizedGame[] {
  const uname = username.toLowerCase();
  return rawGames.map((g) => {
    const players = (g.players || {}) as Record<
      string,
      { user?: { name?: string }; rating?: number }
    >;
    const whiteName = String(players.white?.user?.name || "").toLowerCase();
    const userColor = whiteName === uname ? "white" : "black";
    const oppColor = userColor === "white" ? "black" : "white";
    const winner = g.winner as string | null | undefined;
    let result = "Draw";
    if (winner === userColor) result = "Win";
    else if (winner === oppColor) result = "Loss";
    const opening = (g.opening || {}) as { name?: string; eco?: string };
    const movesStr = String(g.moves || "");
    const moveCount = movesStr
      ? Math.max(1, Math.floor(movesStr.split(/\s+/).filter(Boolean).length / 2))
      : 30;
    const status = String(g.status || "normal");
    let userTerm = status;
    let oppTerm = status;
    if (status === "timeout") {
      if (winner === userColor) {
        userTerm = "win";
        oppTerm = "timeout";
      } else if (winner === oppColor) {
        userTerm = "timeout";
        oppTerm = "win";
      }
    }
    const clock = (g.clock || {}) as { initial?: number; increment?: number };
    let timeControl = "";
    if (clock.initial != null) {
      timeControl = `${Math.floor(Number(clock.initial) / 1000)}+${Math.floor(Number(clock.increment || 0) / 1000)}`;
    }
    const endedMs = lichessGameEndMs(g);
    return {
      id: String(g.id || ""),
      created_at: toIso(endedMs),
      speed: String(g.speed || "blitz"),
      user_color: userColor,
      user_rating: players[userColor]?.rating,
      opp_rating: players[oppColor]?.rating,
      opponent_name: String(players[oppColor]?.user?.name || "Unknown"),
      result,
      opening_name: opening.name || "Unknown",
      opening_eco: opening.eco || "UNK",
      move_count: moveCount,
      moves_str: movesStr,
      pgn_str: "",
      time_control: timeControl,
      termination: userTerm.replace(/^\w/, (c) => c.toUpperCase()),
      opp_termination: oppTerm.replace(/^\w/, (c) => c.toUpperCase()),
    };
  });
}

const DRAW_OUTCOMES = new Set([
  "agreed",
  "repetition",
  "stalemate",
  "insufficient",
  "50move",
  "timevsinsufficient",
]);

function parseChesscomGames(
  rawGames: Array<Record<string, unknown>>,
  username: string
): NormalizedGame[] {
  const uname = username.toLowerCase();
  return rawGames.map((g) => {
    const white = (g.white || {}) as {
      username?: string;
      result?: string;
      rating?: number;
    };
    const black = (g.black || {}) as {
      username?: string;
      result?: string;
      rating?: number;
    };
    const isWhite = String(white.username || "").toLowerCase() === uname;
    const userColor = isWhite ? "white" : "black";
    const userData = isWhite ? white : black;
    const oppData = isWhite ? black : white;
    const userResult = String(userData.result || "");
    let result = "Loss";
    if (userResult === "win") result = "Win";
    else if (DRAW_OUTCOMES.has(userResult)) result = "Draw";
    const pgnStr = String(g.pgn || "");
    const ecoMatch = pgnStr.match(/\[ECO "([^"]+)"\]/);
    const openingEco = ecoMatch?.[1] || "UNK";
    let ecoUrl = String(g.eco || "");
    if (!ecoUrl) {
      const ecoUrlMatch = pgnStr.match(/\[ECOUrl "([^"]+)"\]/);
      ecoUrl = ecoUrlMatch?.[1] || "";
    }
    let openingName = "Unknown";
    if (ecoUrl) {
      const raw = ecoUrl.split("/").pop() || "";
      openingName = raw.replace(/-/g, " ").replace(/\d+$/, "").trim() || "Unknown";
    }
    const moveMatches = pgnStr.match(/\d+\.\s/g);
    const moveCount = moveMatches?.length || 35;
    const movesStr = movesFromPgn(pgnStr);
    const url = String(g.url || "");
    return {
      id: url.split("/").pop() || url,
      created_at: toIso(Number(g.end_time || 0)),
      speed: String(g.time_class || "blitz"),
      user_color: userColor,
      user_rating: userData.rating,
      opp_rating: oppData.rating,
      opponent_name: String(oppData.username || "Unknown"),
      result,
      opening_name: openingName,
      opening_eco: openingEco,
      move_count: Math.max(moveCount, 1),
      moves_str: movesStr,
      pgn_str: pgnStr,
      time_control: String(g.time_control || ""),
      termination: userResult
        ? userResult.replace(/^\w/, (c) => c.toUpperCase())
        : "Normal",
      opp_termination: oppData.result
        ? String(oppData.result).replace(/^\w/, (c) => c.toUpperCase())
        : "Normal",
    };
  });
}

function dateKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function filterNormalizedGames(
  games: NormalizedGame[],
  filters: QueryFilters
): NormalizedGame[] {
  return games.filter((g) => {
    if (
      filters.speed &&
      String(g.speed || "").toLowerCase() !== filters.speed.toLowerCase()
    ) {
      return false;
    }
    if (
      filters.color &&
      String(g.user_color || "").toLowerCase() !== filters.color.toLowerCase()
    ) {
      return false;
    }
    if (filters.result && g.result !== filters.result) return false;
    const key = dateKey(g.created_at);
    if (filters.dateFrom && key && key < filters.dateFrom) return false;
    if (filters.dateTo && key && key > filters.dateTo) return false;
    return true;
  });
}

export function toStudyGameList(games: NormalizedGame[]): StudyGame[] {
  return games.map((g) => ({
    id: g.id,
    created_at: g.created_at,
    speed: g.speed,
    user_color: g.user_color,
    result: g.result,
    opening_name: g.opening_name,
    opening_eco: g.opening_eco,
    opponent_name: g.opponent_name,
    pgn_str: g.pgn_str,
    moves_str: g.moves_str,
    time_control: g.time_control,
    user_rating: g.user_rating,
    opp_rating: g.opp_rating,
    move_count: g.move_count,
  }));
}

export async function ingestPlatformGames(
  username: string,
  platform: Platform,
  timeframe: Timeframe | string,
  force = false
): Promise<NormalizedGame[]> {
  if (!username.trim()) return [];
  const { sinceTimestamp, sinceMs } = sinceForTimeframe(timeframe);
  if (platform === "chesscom") {
    const raw = await fetchChesscomGamesRaw(username, sinceTimestamp, force);
    return parseChesscomGames(raw, username);
  }
  const raw = await fetchLichessGamesRaw(username, sinceMs, force);
  return parseLichessGames(raw, username);
}

export type LocalGamesPage = {
  games: StudyGame[];
  total: number;
  allFiltered: NormalizedGame[];
  limit: number;
  offset: number;
  has_more: boolean;
};

export async function loadLocalGamesPage(
  filters: QueryFilters,
  options?: {
    force?: boolean;
    limit?: number;
    offset?: number;
  }
): Promise<LocalGamesPage> {
  const username = filters.username.trim();
  const limit = Math.max(
    1,
    Math.min(options?.limit ?? GAMES_FIRST_PAGE_SIZE, GAMES_PAGE_SIZE)
  );
  const offset = Math.max(0, options?.offset ?? 0);
  if (!username) {
    return {
      games: [],
      total: 0,
      allFiltered: [],
      limit,
      offset,
      has_more: false,
    };
  }
  const fk = `${filters.platform}|${username.toLowerCase()}|${filters.timeframe}|${options?.force ? "force" : "soft"}`;
  return takeInflight(`local-ingest:${fk}`, async () => {
    const ingested = await ingestPlatformGames(
      username,
      filters.platform,
      filters.timeframe,
      Boolean(options?.force)
    );
    const filtered = filterNormalizedGames(ingested, filters).sort((a, b) =>
      String(b.created_at).localeCompare(String(a.created_at))
    );
    const page = filtered.slice(offset, offset + limit);
    return {
      games: toStudyGameList(page),
      total: filtered.length,
      allFiltered: filtered,
      limit,
      offset,
      has_more: offset + page.length < filtered.length,
    };
  });
}

export async function findLocalGameById(
  filters: QueryFilters,
  gameId: string
): Promise<NormalizedGame | null> {
  const page = await loadLocalGamesPage(filters, {
    limit: GAMES_PAGE_SIZE,
    offset: 0,
  });
  return (
    page.allFiltered.find((g) => g.id === gameId) ||
    page.allFiltered.find((g) => String(g.id).endsWith(gameId)) ||
    null
  );
}
