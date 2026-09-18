import type { MistakeItem } from "../api/client";
import type { NormalizedGame } from "./platformGames";

export type LichessStudyResult = {
  studyId: string;
  url: string;
};

function buildPgnFromMistake(
  moment: MistakeItem,
  game: NormalizedGame | null
): string {
  if (game?.pgn_str?.trim()) return game.pgn_str.trim();
  const moves = game?.moves_str?.trim() || "";
  const headers = [
    `[Event "Chess Wrapped mistake"]`,
    `[Site "https://lichess.org"]`,
    `[Date "${(moment.created_at || "").slice(0, 10).replace(/-/g, ".") || "????.??.??"}"]`,
    `[White "${moment.user_color === "white" ? "Me" : moment.opponent_name || "Opponent"}"]`,
    `[Black "${moment.user_color === "black" ? "Me" : moment.opponent_name || "Opponent"}"]`,
    `[Result "*"]`,
    `[ECO "${moment.opening_eco || "?"}"]`,
    `[Opening "${moment.opening_name || "?"}"]`,
    `[FEN "${moment.fen}"]`,
    `[SetUp "1"]`,
  ];
  const body = moves
    ? moves
    : moment.best_san || moment.best_uci
      ? `{ Best: ${moment.best_san || moment.best_uci}; played ${moment.played_san} }`
      : `{ Critical position }`;
  return `${headers.join("\n")}\n\n${body} *\n`;
}

export async function addMistakeToLichessStudy(options: {
  accessToken: string;
  moment: MistakeItem;
  game?: NormalizedGame | null;
  studyName?: string;
}): Promise<LichessStudyResult> {
  const { accessToken, moment, game = null } = options;
  const name =
    options.studyName ||
    `Mistake · ${moment.opening_name || "Position"} · move ${
      moment.move_number || Math.floor(moment.ply / 2) + 1
    }`;
  const pgn = buildPgnFromMistake(moment, game);
  const body = new URLSearchParams();
  body.set("name", name.slice(0, 100));
  body.set("pgn", pgn);
  body.set("orientation", moment.user_color === "black" ? "black" : "white");

  const res = await fetch("https://lichess.org/api/study/import-pgn", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = await res.text();
    } catch {
      void 0;
    }
    throw new Error(`Lichess study import failed (${res.status}): ${detail}`);
  }
  const json = (await res.json()) as {
    id?: string;
    chapters?: Array<{ id?: string; name?: string }>;
  };
  const studyId = String(json.id || "");
  if (!studyId) throw new Error("Lichess study response missing id");
  return {
    studyId,
    url: `https://lichess.org/study/${studyId}`,
  };
}
