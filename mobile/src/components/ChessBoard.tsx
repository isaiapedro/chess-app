import React, { useMemo, useState } from "react";
import {
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Svg, { Path } from "react-native-svg";
import { Chess, Square } from "chess.js";
import { tryMove, uciFromMove } from "../engine/chessMoves";
import { colors, font, radius, withAlpha } from "../theme";
import {
  ALPHA_PIECES,
  ALPHA_VIEWBOX,
  type AlphaPieceKey,
} from "./pieces/alphaPieces";

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
const RANKS_WHITE = [8, 7, 6, 5, 4, 3, 2, 1] as const;
const RANKS_BLACK = [1, 2, 3, 4, 5, 6, 7, 8] as const;

type Props = {
  fen: string;
  orientation?: "white" | "black";
  interactive?: boolean;
  onMove?: (uci: string, san: string, fenAfter: string) => void;
  highlightUci?: string | null;
  guessUci?: string | null;
};

function squareColor(fileIdx: number, rankIdx: number): string {
  return (fileIdx + rankIdx) % 2 === 0 ? colors.boardLight : colors.boardDark;
}

function PieceSvg({
  pieceKey,
  size,
}: {
  pieceKey: AlphaPieceKey;
  size: number;
}) {
  const paths = ALPHA_PIECES[pieceKey];
  if (!paths?.length) return null;
  return (
    <Svg width={size} height={size} viewBox={ALPHA_VIEWBOX}>
      {paths.map((path, index) => (
        <Path key={`${pieceKey}-${index}`} d={path.d} fill={path.fill} />
      ))}
    </Svg>
  );
}

export function ChessBoard({
  fen,
  orientation = "white",
  interactive = true,
  onMove,
  highlightUci,
  guessUci,
}: Props) {
  const [size, setSize] = useState(320);
  const [selected, setSelected] = useState<Square | null>(null);

  const chess = useMemo(() => {
    try {
      return new Chess(fen);
    } catch {
      return new Chess();
    }
  }, [fen]);

  const ranks = orientation === "white" ? [...RANKS_WHITE] : [...RANKS_BLACK];
  const files = orientation === "white" ? [...FILES] : [...FILES].reverse();

  const fromHi = highlightUci?.slice(0, 2) as Square | undefined;
  const toHi = highlightUci?.slice(2, 4) as Square | undefined;
  const fromGuess = guessUci?.slice(0, 2) as Square | undefined;
  const toGuess = guessUci?.slice(2, 4) as Square | undefined;

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0) setSize(w);
  };

  const sqSize = size / 8;
  const pieceSize = sqSize * 0.78;

  const legalTargets = useMemo(() => {
    if (!selected) return new Set<string>();
    const selectedPiece = chess.get(selected);
    const targets = new Set(
      chess.moves({ square: selected, verbose: true }).map((m) => m.to)
    );
    if (selectedPiece?.type === "k") {
      const castles = chess
        .moves({ square: selected, verbose: true })
        .filter((m) => m.flags.includes("k") || m.flags.includes("q"));
      for (const castle of castles) {
        const rookFile = castle.flags.includes("q") ? "a" : "h";
        targets.add(`${rookFile}${selected[1]}` as Square);
      }
    }
    return targets;
  }, [chess, selected]);

  const commitMove = (from: Square, to: Square) => {
    const moveResult = tryMove(fen, from, to);
    if (moveResult) {
      onMove?.(uciFromMove(moveResult), moveResult.san, moveResult.after);
    }
    setSelected(null);
  };

  const handlePress = (sq: Square) => {
    if (!interactive) return;
    const piece = chess.get(sq);

    if (!selected) {
      if (piece && piece.color === chess.turn()) {
        setSelected(sq);
      }
      return;
    }

    if (selected === sq) {
      setSelected(null);
      return;
    }

    const selectedPiece = chess.get(selected);
    if (
      piece &&
      piece.color === chess.turn() &&
      !(
        selectedPiece?.type === "k" &&
        piece.type === "r" &&
        legalTargets.has(sq)
      )
    ) {
      setSelected(sq);
      return;
    }

    commitMove(selected, sq);
  };

  return (
    <View style={styles.wrap} onLayout={onLayout}>
      <View style={[styles.boardShadow]}>
        <View style={[styles.board, { width: size, height: size }]}>
          {ranks.map((rank, rankIdx) => (
            <View key={`r${rank}`} style={styles.row}>
              {files.map((file, fileIdx) => {
                const sq = `${file}${rank}` as Square;
                const piece = chess.get(sq);
                const pieceKey = piece
                  ? (`${piece.color}${piece.type.toUpperCase()}` as AlphaPieceKey)
                  : null;
                const isSel = selected === sq;
                const isTarget = legalTargets.has(sq);
                const isHi = sq === fromHi || sq === toHi;
                const isGuess =
                  !isHi && (sq === fromGuess || sq === toGuess);
                const isLight = (fileIdx + rankIdx) % 2 === 0;
                return (
                  <Pressable
                    key={sq}
                    onPress={() => handlePress(sq)}
                    style={[
                      styles.square,
                      {
                        width: sqSize,
                        height: sqSize,
                        backgroundColor: squareColor(fileIdx, rankIdx),
                      },
                      isSel && styles.selected,
                      isGuess && styles.guessHighlight,
                      isHi && styles.highlight,
                    ]}
                  >
                    {isTarget && !piece ? <View style={styles.dot} /> : null}
                    {isTarget && piece ? <View style={styles.captureRing} /> : null}
                    {pieceKey ? <PieceSvg pieceKey={pieceKey} size={pieceSize} /> : null}
                    {fileIdx === 0 ? (
                      <Text
                        style={[
                          styles.coord,
                          styles.rankCoord,
                          { color: isLight ? colors.boardDark : colors.boardLight },
                        ]}
                      >
                        {rank}
                      </Text>
                    ) : null}
                    {rankIdx === ranks.length - 1 ? (
                      <Text
                        style={[
                          styles.coord,
                          styles.fileCoord,
                          { color: isLight ? colors.boardDark : colors.boardLight },
                        ]}
                      >
                        {file}
                      </Text>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: "100%",
    alignItems: "center",
  },
  boardShadow: {
    backgroundColor: "transparent",
  },
  board: {
    borderRadius: radius.md,
    overflow: "hidden",
    backgroundColor: colors.boardDark,
  },
  row: {
    flexDirection: "row",
  },
  square: {
    alignItems: "center",
    justifyContent: "center",
  },
  selected: {
    borderWidth: 2,
    borderColor: colors.sage,
  },
  highlight: {
    backgroundColor: withAlpha(colors.sage, 0.5),
  },
  guessHighlight: {
    backgroundColor: withAlpha(colors.blue, 0.5),
  },
  coord: {
    position: "absolute",
    zIndex: 2,
    fontFamily: font.sansMedium,
    fontSize: 10,
    lineHeight: 12,
    includeFontPadding: false,
  },
  rankCoord: {
    top: 3,
    left: 4,
  },
  fileCoord: {
    bottom: 3,
    right: 4,
  },
  dot: {
    position: "absolute",
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: withAlpha(colors.red, 0.45),
  },
  captureRing: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: radius.xs,
    borderWidth: 3,
    borderColor: withAlpha(colors.red, 0.55),
  },
});
