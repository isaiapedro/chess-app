function parseTimeControl(tc: string): { base: number; inc: number } | null {
  const raw = String(tc || "").trim();
  if (!raw || raw.includes("/")) return null;
  if (raw.includes("+")) {
    const [baseRaw, incRaw] = raw.split("+", 2);
    const base = Number(baseRaw);
    const inc = Number(incRaw);
    if (!Number.isFinite(base) || !Number.isFinite(inc)) return null;
    return { base, inc };
  }
  const base = Number(raw);
  if (!Number.isFinite(base)) return null;
  return { base, inc: 0 };
}

function parseClkToSeconds(tag: string): number {
  const parts = tag.trim().split(":").map(Number);
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return Number(tag) || 0;
}

export type MoveClock = {
  user_avg: number;
  opp_avg: number;
  user_times: number[];
  opp_times: number[];
};

export function extractMoveTimesFromPgn(
  pgnStr: string | undefined,
  timeControl: string | undefined,
  userColor: string
): MoveClock | null {
  if (!pgnStr) return null;
  let base: number | null = null;
  let inc = 0;
  const tc = timeControl || "";
  const parsed = parseTimeControl(tc);
  if (parsed) {
    base = parsed.base;
    inc = parsed.inc;
  } else {
    const tcMatch = pgnStr.match(/\[TimeControl "([^"]+)"\]/);
    if (tcMatch?.[1]) {
      const fromHeader = parseTimeControl(tcMatch[1]);
      if (fromHeader) {
        base = fromHeader.base;
        inc = fromHeader.inc;
      }
    }
  }
  if (base == null) return null;

  const tags = [
    ...pgnStr.matchAll(/\[%clk\s+([^\]]+)\]/gi),
  ].map((m) => m[1]);
  if (tags.length < 2) return null;

  const remTimes = tags.map(parseClkToSeconds);
  const whiteTimes: number[] = [];
  const blackTimes: number[] = [];
  let prevW = base;
  let prevB = base;
  for (let i = 0; i < remTimes.length; i += 1) {
    const rem = remTimes[i];
    if (i % 2 === 0) {
      whiteTimes.push(Math.max(prevW - rem + inc, 0));
      prevW = rem;
    } else {
      blackTimes.push(Math.max(prevB - rem + inc, 0));
      prevB = rem;
    }
  }

  const userIsWhite = String(userColor || "white").toLowerCase() === "white";
  const userTimes = userIsWhite ? whiteTimes : blackTimes;
  const oppTimes = userIsWhite ? blackTimes : whiteTimes;
  if (!userTimes.length || !oppTimes.length) return null;

  const avg = (vals: number[]) =>
    Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;

  return {
    user_avg: avg(userTimes),
    opp_avg: avg(oppTimes),
    user_times: userTimes,
    opp_times: oppTimes,
  };
}
