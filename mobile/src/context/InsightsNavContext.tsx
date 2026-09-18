import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";

type InsightsNavContextValue = {
  depth: number;
  setDepth: (depth: number) => void;
  registerPopHandler: (handler: (() => boolean) | null) => void;
  popNested: () => boolean;
};

const InsightsNavContext = createContext<InsightsNavContextValue | null>(null);

export function InsightsNavProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [depth, setDepthState] = useState(0);
  const depthRef = useRef(0);
  const popHandlerRef = useRef<(() => boolean) | null>(null);

  const setDepth = useCallback((next: number) => {
    depthRef.current = next;
    setDepthState(next);
  }, []);

  const registerPopHandler = useCallback((handler: (() => boolean) | null) => {
    popHandlerRef.current = handler;
  }, []);

  const popNested = useCallback(() => {
    if (depthRef.current <= 0) return false;
    const handler = popHandlerRef.current;
    if (!handler) return false;
    return handler();
  }, []);

  const value = useMemo(
    () => ({
      depth,
      setDepth,
      registerPopHandler,
      popNested,
    }),
    [depth, setDepth, registerPopHandler, popNested]
  );

  return (
    <InsightsNavContext.Provider value={value}>
      {children}
    </InsightsNavContext.Provider>
  );
}

export function useInsightsNav(): InsightsNavContextValue {
  const ctx = useContext(InsightsNavContext);
  if (!ctx) {
    throw new Error("useInsightsNav must be used within InsightsNavProvider");
  }
  return ctx;
}
