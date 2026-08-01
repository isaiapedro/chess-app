import React, { useEffect } from "react";
import { useFilters } from "../context/FilterContext";
import { useStockfish } from "./StockfishProvider";
import { prefetchStudyContent } from "./studyPrefetch";

export function StudyPrefetch() {
  const { queryFilters, refreshToken } = useFilters();
  const { ready, evaluate } = useStockfish();

  useEffect(() => {
    if (!ready) return;

    const signal = { cancelled: false };
    void prefetchStudyContent({
      filters: queryFilters,
      evaluate,
      signal,
    }).catch(() => undefined);

    return () => {
      signal.cancelled = true;
    };
  }, [ready, evaluate, queryFilters, refreshToken]);

  return null;
}
