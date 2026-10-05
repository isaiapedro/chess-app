import { normalizeGameResult } from "./winProb";

export type KingBadgeKind = "win" | "loss" | "draw";
export type KingBadgeIcon = "crown" | "skull" | "handshake";

export type GameEndKingVisual = {
  kind: KingBadgeKind;
  icon: KingBadgeIcon;
  kings: "user" | "both";
  userSide: "w" | "b";
  sides: ("w" | "b")[];
};

function fallbackNorm(
  gameResult: string | null | undefined
): "Win" | "Draw" | "Loss" | "" {
  const v = String(gameResult || "")
    .toLowerCase()
    .replace(/\s+/g, "");
  if (v.includes("win")) return "Win";
  if (v.includes("loss")) return "Loss";
  if (v.includes("draw") || v === "1/2-1/2" || v === "½-½") return "Draw";
  return "";
}

export function gameEndKingVisual(
  gameResult: string | null | undefined,
  userColor: "white" | "black" = "white"
): GameEndKingVisual | null {
  const userIsWhite = userColor !== "black";
  const userSide: "w" | "b" = userIsWhite ? "w" : "b";
  const norm =
    normalizeGameResult(gameResult, userIsWhite) || fallbackNorm(gameResult);
  if (norm === "Win") {
    return {
      kind: "win",
      icon: "crown",
      kings: "user",
      userSide,
      sides: [userSide],
    };
  }
  if (norm === "Loss") {
    return {
      kind: "loss",
      icon: "skull",
      kings: "user",
      userSide,
      sides: [userSide],
    };
  }
  if (norm === "Draw") {
    return {
      kind: "draw",
      icon: "handshake",
      kings: "both",
      userSide,
      sides: ["w", "b"],
    };
  }
  return null;
}
