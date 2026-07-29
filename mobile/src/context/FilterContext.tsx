import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import type { DatePreset, Platform, Timeframe } from "../api/types";
import type { QueryFilters } from "../api/client";

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function startOfWeek(d: Date): Date {
  const copy = new Date(d);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function resolveDateRange(
  preset: DatePreset,
  customFrom: Date | null,
  customTo: Date | null
): { dateFrom: string | null; dateTo: string | null } {
  const now = new Date();
  if (preset === "all") return { dateFrom: null, dateTo: null };
  if (preset === "custom") {
    return {
      dateFrom: customFrom ? isoDate(customFrom) : null,
      dateTo: customTo ? isoDate(customTo) : null,
    };
  }
  if (preset === "day") {
    const day = isoDate(now);
    return { dateFrom: day, dateTo: day };
  }
  if (preset === "week") {
    const start = startOfWeek(now);
    return { dateFrom: isoDate(start), dateTo: isoDate(now) };
  }
  if (preset === "month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { dateFrom: isoDate(start), dateTo: isoDate(now) };
  }
  if (preset === "year") {
    const start = new Date(now.getFullYear(), 0, 1);
    return { dateFrom: isoDate(start), dateTo: isoDate(now) };
  }
  return { dateFrom: null, dateTo: null };
}

type FilterContextValue = {
  username: string;
  setUsername: (v: string) => void;
  platform: Platform;
  setPlatform: (v: Platform) => void;
  timeframe: Timeframe;
  setTimeframe: (v: Timeframe) => void;
  datePreset: DatePreset;
  setDatePreset: (v: DatePreset) => void;
  customFrom: Date | null;
  setCustomFrom: (v: Date | null) => void;
  customTo: Date | null;
  setCustomTo: (v: Date | null) => void;
  speed: string | null;
  setSpeed: (v: string | null) => void;
  color: "white" | "black" | null;
  setColor: (v: "white" | "black" | null) => void;
  queryFilters: QueryFilters;
  refreshToken: number;
  refresh: () => void;
};

const FilterContext = createContext<FilterContextValue | null>(null);

export function FilterProvider({ children }: { children: React.ReactNode }) {
  const [username, setUsername] = useState("pedroisaia");
  const [platform, setPlatform] = useState<Platform>("chesscom");
  const [timeframe, setTimeframe] = useState<Timeframe>("1 month");
  const [datePreset, setDatePreset] = useState<DatePreset>("all");
  const [customFrom, setCustomFrom] = useState<Date | null>(null);
  const [customTo, setCustomTo] = useState<Date | null>(null);
  const [speed, setSpeed] = useState<string | null>(null);
  const [color, setColor] = useState<"white" | "black" | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  const refresh = useCallback(() => {
    setRefreshToken((n) => n + 1);
  }, []);

  const queryFilters = useMemo<QueryFilters>(() => {
    const range = resolveDateRange(datePreset, customFrom, customTo);
    return {
      username: username.trim() || "pedroisaia",
      platform,
      timeframe,
      speed,
      color,
      dateFrom: range.dateFrom,
      dateTo: range.dateTo,
    };
  }, [
    username,
    platform,
    timeframe,
    datePreset,
    customFrom,
    customTo,
    speed,
    color,
  ]);

  const value = useMemo(
    () => ({
      username,
      setUsername,
      platform,
      setPlatform,
      timeframe,
      setTimeframe,
      datePreset,
      setDatePreset,
      customFrom,
      setCustomFrom,
      customTo,
      setCustomTo,
      speed,
      setSpeed,
      color,
      setColor,
      queryFilters,
      refreshToken,
      refresh,
    }),
    [
      username,
      platform,
      timeframe,
      datePreset,
      customFrom,
      customTo,
      speed,
      color,
      queryFilters,
      refreshToken,
      refresh,
    ]
  );

  return (
    <FilterContext.Provider value={value}>{children}</FilterContext.Provider>
  );
}

export function useFilters(): FilterContextValue {
  const ctx = useContext(FilterContext);
  if (!ctx) {
    throw new Error("useFilters must be used within FilterProvider");
  }
  return ctx;
}
