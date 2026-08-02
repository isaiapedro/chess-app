import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import type { Period, Platform, Timeframe } from "../api/types";
import type { QueryFilters } from "../api/client";

function isoDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const PERIOD_TIMEFRAME: Record<Period, Timeframe> = {
  all: "1 year",
  year: "1 year",
  month: "1 month",
  week: "1 month",
  day: "1 month",
};

function resolveDateRange(
  period: Period,
  selectedDay: Date
): { dateFrom: string | null; dateTo: string | null } {
  const now = new Date();
  if (period === "day") {
    const day = isoDate(selectedDay);
    return { dateFrom: day, dateTo: day };
  }
  if (period === "week") {
    const start = new Date(now);
    start.setDate(start.getDate() - 6);
    start.setHours(0, 0, 0, 0);
    return { dateFrom: isoDate(start), dateTo: isoDate(now) };
  }
  if (period === "month") {
    const start = new Date(now);
    start.setDate(start.getDate() - 29);
    start.setHours(0, 0, 0, 0);
    return { dateFrom: isoDate(start), dateTo: isoDate(now) };
  }
  if (period === "year") {
    const start = new Date(now);
    start.setFullYear(start.getFullYear() - 1);
    start.setHours(0, 0, 0, 0);
    return { dateFrom: isoDate(start), dateTo: isoDate(now) };
  }
  return { dateFrom: null, dateTo: null };
}

function shortDate(d: Date): string {
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function buildPeriodLabel(period: Period, selectedDay: Date): string {
  const now = new Date();
  if (period === "year") {
    const start = new Date(now);
    start.setFullYear(start.getFullYear() - 1);
    return `${shortDate(start)} – ${shortDate(now)}`;
  }
  if (period === "month") {
    const start = new Date(now);
    start.setDate(start.getDate() - 29);
    return `${shortDate(start)} – ${shortDate(now)}`;
  }
  if (period === "week") {
    const start = new Date(now);
    start.setDate(start.getDate() - 6);
    return `${shortDate(start)} – ${shortDate(now)}`;
  }
  if (period === "day") {
    return selectedDay.toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }
  return "All Time";
}

type FilterContextValue = {
  username: string;
  setUsername: (v: string) => void;
  platform: Platform;
  setPlatform: (v: Platform) => void;
  period: Period;
  setPeriod: (v: Period) => void;
  selectedDay: Date;
  setSelectedDay: (v: Date) => void;
  periodLabel: string;
  speed: string | null;
  setSpeed: (v: string | null) => void;
  dayCalendarOpen: boolean;
  setDayCalendarOpen: (open: boolean) => void;
  filterChromeBottom: number;
  setFilterChromeBottom: (n: number) => void;
  queryFilters: QueryFilters;
  refreshToken: number;
  refresh: () => void;
};

const FilterContext = createContext<FilterContextValue | null>(null);

export function FilterProvider({ children }: { children: React.ReactNode }) {
  const [username, setUsername] = useState("pedroisaia");
  const [platform, setPlatform] = useState<Platform>("chesscom");
  const [period, setPeriod] = useState<Period>("month");
  const [selectedDay, setSelectedDay] = useState<Date>(new Date());
  const [speed, setSpeed] = useState<string | null>(null);
  const [dayCalendarOpen, setDayCalendarOpen] = useState(false);
  const [filterChromeBottom, setFilterChromeBottom] = useState(0);
  const [refreshToken, setRefreshToken] = useState(0);

  const refresh = useCallback(() => {
    setRefreshToken((n) => n + 1);
  }, []);

  const setPeriodAndCloseCalendar = useCallback((v: Period) => {
    setPeriod(v);
    if (v !== "day") setDayCalendarOpen(false);
  }, []);

  const queryFilters = useMemo<QueryFilters>(() => {
    const range = resolveDateRange(period, selectedDay);
    return {
      username: username.trim() || "pedroisaia",
      platform,
      timeframe: PERIOD_TIMEFRAME[period],
      speed,
      dateFrom: range.dateFrom,
      dateTo: range.dateTo,
    };
  }, [username, platform, period, selectedDay, speed]);

  const periodLabel = useMemo(
    () => buildPeriodLabel(period, selectedDay),
    [period, selectedDay]
  );

  const value = useMemo(
    () => ({
      username,
      setUsername,
      platform,
      setPlatform,
      period,
      setPeriod: setPeriodAndCloseCalendar,
      selectedDay,
      setSelectedDay,
      periodLabel,
      speed,
      setSpeed,
      dayCalendarOpen,
      setDayCalendarOpen,
      filterChromeBottom,
      setFilterChromeBottom,
      queryFilters,
      refreshToken,
      refresh,
    }),
    [
      username,
      platform,
      period,
      setPeriodAndCloseCalendar,
      selectedDay,
      periodLabel,
      speed,
      dayCalendarOpen,
      filterChromeBottom,
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
