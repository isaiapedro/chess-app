import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Image,
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ImageSourcePropType,
} from "react-native";
import Svg, { Path } from "react-native-svg";
import { Chess, Square } from "chess.js";
import { tryMove, uciFromMove } from "../engine/chessMoves";
import { AppIcon } from "../icons";
import { colors, font, radius, withAlpha } from "../theme";
import { Crown, Skull } from "lucide-react-native";
import {
  ALPHA_PIECES,
  ALPHA_VIEWBOX,
  type AlphaPieceKey,
} from "./pieces/alphaPieces";

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
const FILES_BLACK = ["h", "g", "f", "e", "d", "c", "b", "a"] as const;
const RANKS_WHITE = [8, 7, 6, 5, 4, 3, 2, 1] as const;
const RANKS_BLACK = [1, 2, 3, 4, 5, 6, 7, 8] as const;
const MOVE_ANIM_MS = 176;

type Props = {
  fen: string;
  orientation?: "white" | "black";
  interactive?: boolean;
  onMove?: (uci: string, san: string, fenAfter: string) => void;
  highlightUci?: string | null;
  guessUci?: string | null;
  markUci?: string | null;
  markSource?: ImageSourcePropType | null;
  markKey?: string | null;
  animateUci?: string | null;
  onAnimateEnd?: () => void;
  arrowUci?: string | null;
  kingBadge?: "win" | "loss" | null;
};

function parseUciSquares(uci?: string | null): { from: Square; to: Square } | null {
  if (!uci || uci.length < 4) return null;
  return { from: uci.slice(0, 2) as Square, to: uci.slice(2, 4) as Square };
}

function castleRookSquares(
  from: Square,
  to: Square,
  pieceType: string | undefined
): { from: Square; to: Square } | null {
  if (pieceType !== "k" || from[1] !== to[1]) return null;
  const d = to.charCodeAt(0) - from.charCodeAt(0);
  const rank = from[1];
  if (d === 2) return { from: `h${rank}` as Square, to: `f${rank}` as Square };
  if (d === -2) return { from: `a${rank}` as Square, to: `d${rank}` as Square };
  return null;
}

function enPassantCaptureSq(
  from: Square,
  to: Square,
  piece: { type: string } | null,
  destOccupied: boolean
): Square | null {
  if (!piece || piece.type !== "p" || destOccupied) return null;
  if (from[0] === to[0] || from[1] === to[1]) return null;
  return `${to[0]}${from[1]}` as Square;
}

function findKingSquare(
  chess: Chess,
  color: "w" | "b"
): Square | null {
  for (const file of FILES) {
    for (let rank = 1; rank <= 8; rank += 1) {
      const sq = `${file}${rank}` as Square;
      const piece = chess.get(sq);
      if (piece?.type === "k" && piece.color === color) return sq;
    }
  }
  return null;
}

function squareTopLeft(
  sq: Square,
  files: readonly string[],
  ranks: readonly number[],
  sqSize: number
): { x: number; y: number } | null {
  const fileIdx = files.findIndex((f) => f === sq[0]);
  const rankIdx = ranks.findIndex((r) => r === Number(sq[1]));
  if (fileIdx < 0 || rankIdx < 0) return null;
  return { x: fileIdx * sqSize, y: rankIdx * sqSize };
}

function arrowPath(
  from: { x: number; y: number },
  to: { x: number; y: number },
  sqSize: number
): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 8) return "";
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy;
  const py = ux;
  const pad = sqSize * 0.08;
  const headLen = sqSize * 0.55;
  const headW = sqSize * 0.38;
  const shaftW = Math.max(12, sqSize * 0.26);
  const x1 = from.x + ux * pad;
  const y1 = from.y + uy * pad;
  const x2 = to.x - ux * pad;
  const y2 = to.y - uy * pad;
  const shaft = Math.hypot(x2 - x1, y2 - y1) - headLen;
  if (shaft < 4) return "";
  const hx = x1 + ux * shaft;
  const hy = y1 + uy * shaft;
  const hw = shaftW / 2;
  const pts = [
    [x1 + px * hw, y1 + py * hw],
    [hx + px * hw, hy + py * hw],
    [hx + px * headW, hy + py * headW],
    [x2, y2],
    [hx - px * headW, hy - py * headW],
    [hx - px * hw, hy - py * hw],
    [x1 - px * hw, y1 - py * hw],
  ];
  return `M ${pts.map((p) => p.join(" ")).join(" L ")} Z`;
}

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
  markUci,
  markSource,
  markKey,
  animateUci,
  onAnimateEnd,
  arrowUci,
  kingBadge,
}: Props) {
  const [size, setSize] = useState(320);
  const [selected, setSelected] = useState<Square | null>(null);
  const flyXY = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const rookXY = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const flyGen = useRef(0);
  const onAnimateEndRef = useRef(onAnimateEnd);
  onAnimateEndRef.current = onAnimateEnd;
  const prevFenRef = useRef(fen);
  const settledFenRef = useRef(fen);
  const lastAnimUciRef = useRef<string | null>(null);

  const parsedAnim = parseUciSquares(animateUci);
  if (!parsedAnim) {
    settledFenRef.current = fen;
    lastAnimUciRef.current = null;
  } else if (lastAnimUciRef.current !== animateUci) {
    settledFenRef.current = prevFenRef.current;
    lastAnimUciRef.current = animateUci ?? null;
  }
  prevFenRef.current = fen;
  const animating = Boolean(parsedAnim && settledFenRef.current !== fen);
  const displayFen = animating ? settledFenRef.current : fen;

  useEffect(() => {
    setSelected(null);
  }, [displayFen]);

  const chess = useMemo(() => {
    try {
      return new Chess(displayFen);
    } catch {
      return new Chess();
    }
  }, [displayFen]);

  const ranks = orientation === "white" ? RANKS_WHITE : RANKS_BLACK;
  const files = orientation === "white" ? FILES : FILES_BLACK;

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0) setSize(w);
  };

  const sqSize = size / 8;
  const pieceSize = sqSize * 0.78;
  const markSize = sqSize * 0.42;

  const flyFrom = parsedAnim && animating ? parsedAnim.from : null;
  const flyTo = parsedAnim && animating ? parsedAnim.to : null;
  const flyPiece = flyFrom ? chess.get(flyFrom) : null;
  const flyPieceKey = flyPiece
    ? (`${flyPiece.color}${flyPiece.type.toUpperCase()}` as AlphaPieceKey)
    : null;
  const rookSq =
    flyFrom && flyTo
      ? castleRookSquares(flyFrom, flyTo, flyPiece?.type)
      : null;
  const rookFrom = rookSq?.from ?? null;
  const rookTo = rookSq?.to ?? null;
  const rookPiece = rookFrom ? chess.get(rookFrom) : null;
  const rookPieceKey =
    rookPiece?.type === "r"
      ? (`${rookPiece.color}${rookPiece.type.toUpperCase()}` as AlphaPieceKey)
      : null;
  const captureSq =
    flyFrom && flyTo
      ? enPassantCaptureSq(
          flyFrom,
          flyTo,
          flyPiece,
          Boolean(chess.get(flyTo))
        )
      : null;
  const hideSq = new Set(
    [flyFrom, rookFrom, flyTo, captureSq].filter(Boolean) as Square[]
  );

  useLayoutEffect(() => {
    if (!animating || !flyFrom || !flyTo || !flyPieceKey || sqSize <= 0) {
      flyGen.current += 1;
      flyXY.stopAnimation();
      rookXY.stopAnimation();
      return;
    }
    const from = squareTopLeft(flyFrom, files, ranks, sqSize);
    const to = squareTopLeft(flyTo, files, ranks, sqSize);
    if (!from || !to) {
      settledFenRef.current = fen;
      lastAnimUciRef.current = null;
      onAnimateEndRef.current?.();
      return;
    }
    const rookFromXY =
      rookFrom && rookTo
        ? squareTopLeft(rookFrom, files, ranks, sqSize)
        : null;
    const rookToXY =
      rookFrom && rookTo ? squareTopLeft(rookTo, files, ranks, sqSize) : null;
    const gen = ++flyGen.current;
    flyXY.setValue(from);
    const kingAnim = Animated.timing(flyXY, {
      toValue: to,
      duration: MOVE_ANIM_MS,
      easing: Easing.linear,
      useNativeDriver: true,
    });
    const runs: Animated.CompositeAnimation[] = [kingAnim];
    if (rookFromXY && rookToXY && rookPieceKey) {
      rookXY.setValue(rookFromXY);
      runs.push(
        Animated.timing(rookXY, {
          toValue: rookToXY,
          duration: MOVE_ANIM_MS,
          easing: Easing.linear,
          useNativeDriver: true,
        })
      );
    }
    Animated.parallel(runs).start(({ finished }) => {
      if (gen !== flyGen.current) return;
      settledFenRef.current = fen;
      lastAnimUciRef.current = null;
      if (finished) onAnimateEndRef.current?.();
    });
    return () => {
      flyGen.current += 1;
      flyXY.stopAnimation();
      rookXY.stopAnimation();
    };
  }, [
    animating,
    fen,
    files,
    flyFrom,
    flyPieceKey,
    flyTo,
    flyXY,
    ranks,
    rookFrom,
    rookPieceKey,
    rookTo,
    rookXY,
    sqSize,
  ]);

  const fromHi = highlightUci?.slice(0, 2) as Square | undefined;
  const toHi = highlightUci?.slice(2, 4) as Square | undefined;
  const fromGuess = guessUci?.slice(0, 2) as Square | undefined;
  const toGuess = guessUci?.slice(2, 4) as Square | undefined;
  const markSq =
    markUci && markUci.length >= 4
      ? (markUci.slice(2, 4) as Square)
      : null;
  const markFileIdx =
    markSq != null ? files.findIndex((f) => f === markSq[0]) : -1;
  const markRankIdx =
    markSq != null ? ranks.findIndex((r) => r === Number(markSq[1])) : -1;
  const showMark =
    !!markSource &&
    markFileIdx >= 0 &&
    markRankIdx >= 0 &&
    (!animating
      ? true
      : Boolean(flyPieceKey) &&
        markUci != null &&
        animateUci != null &&
        markUci.slice(0, 4) === animateUci.slice(0, 4));

  const kingColor = orientation === "white" ? "w" : "b";
  const kingSq =
    kingBadge && !animating ? findKingSquare(chess, kingColor) : null;
  const kingFileIdx =
    kingSq != null ? files.findIndex((f) => f === kingSq[0]) : -1;
  const kingRankIdx =
    kingSq != null ? ranks.findIndex((r) => r === Number(kingSq[1])) : -1;
  const showKingBadge =
    Boolean(kingBadge) && kingFileIdx >= 0 && kingRankIdx >= 0;
  const kingBadgeSize = sqSize * 0.38;

  const arrowParsed = !animating ? parseUciSquares(arrowUci) : null;
  const arrowFrom = arrowParsed
    ? squareTopLeft(arrowParsed.from, files, ranks, sqSize)
    : null;
  const arrowTo = arrowParsed
    ? squareTopLeft(arrowParsed.to, files, ranks, sqSize)
    : null;
  const arrowD =
    arrowFrom && arrowTo
      ? arrowPath(
          { x: arrowFrom.x + sqSize / 2, y: arrowFrom.y + sqSize / 2 },
          { x: arrowTo.x + sqSize / 2, y: arrowTo.y + sqSize / 2 },
          sqSize
        )
      : "";

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
                    {pieceKey && !hideSq.has(sq) ? (
                      <PieceSvg pieceKey={pieceKey} size={pieceSize} />
                    ) : null}
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
          {arrowD ? (
            <Svg
              pointerEvents="none"
              width={size}
              height={size}
              style={styles.overlay}
            >
              <Path d={arrowD} fill={withAlpha(colors.sage, 0.4)} />
            </Svg>
          ) : null}
          {animating && flyPieceKey ? (
            <Animated.View
              pointerEvents="none"
              collapsable={false}
              style={[
                styles.flyPiece,
                {
                  width: sqSize,
                  height: sqSize,
                  transform: flyXY.getTranslateTransform(),
                },
              ]}
            >
              <PieceSvg pieceKey={flyPieceKey} size={pieceSize} />
            </Animated.View>
          ) : null}
          {animating && rookPieceKey ? (
            <Animated.View
              pointerEvents="none"
              collapsable={false}
              style={[
                styles.flyPiece,
                {
                  width: sqSize,
                  height: sqSize,
                  transform: rookXY.getTranslateTransform(),
                },
              ]}
            >
              <PieceSvg pieceKey={rookPieceKey} size={pieceSize} />
            </Animated.View>
          ) : null}
        </View>
        {showMark ? (
          <View
            key={markKey || `${markUci}:${String(markSource)}`}
            pointerEvents="none"
            style={[
              styles.sqMark,
              {
                width: markSize,
                height: markSize,
                borderRadius: markSize / 2,
                left: markFileIdx * sqSize + sqSize - markSize / 2,
                top: markRankIdx * sqSize - markSize / 2,
              },
            ]}
          >
            <Image
              key={markKey || `${markUci}:${String(markSource)}`}
              source={markSource!}
              fadeDuration={0}
              resizeMode="contain"
              style={{
                width: "100%",
                height: "100%",
                borderRadius: markSize / 2,
              }}
            />
          </View>
        ) : null}
        {showKingBadge ? (
          <View
            pointerEvents="none"
            style={[
              styles.kingBadge,
              {
                width: kingBadgeSize,
                height: kingBadgeSize,
                left:
                  kingFileIdx * sqSize + (sqSize - kingBadgeSize) / 2,
                top: kingRankIdx * sqSize - kingBadgeSize * 0.28,
              },
            ]}
          >
            <AppIcon
              icon={kingBadge === "win" ? Crown : Skull}
              size={kingBadgeSize * 0.78}
              color={kingBadge === "win" ? colors.sage : colors.red}
              bold
            />
          </View>
        ) : null}
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
    position: "relative",
    overflow: "visible",
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
  sqMark: {
    position: "absolute",
    zIndex: 8,
    overflow: "hidden",
  },
  kingBadge: {
    position: "absolute",
    zIndex: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  overlay: {
    position: "absolute",
    left: 0,
    top: 0,
    zIndex: 3,
  },
  flyPiece: {
    position: "absolute",
    left: 0,
    top: 0,
    zIndex: 5,
    alignItems: "center",
    justifyContent: "center",
  },
});
