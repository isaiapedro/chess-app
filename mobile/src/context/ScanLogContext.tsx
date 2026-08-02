import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

export type ScanLogLine = {
  id: string;
  at: number;
  text: string;
  phase?: string;
};

type ScanLogState = {
  lines: ScanLogLine[];
  status: string;
  phase: string;
  gamesDone: number;
  gamesTotal: number;
  running: boolean;
};

type ScanLogContextValue = ScanLogState & {
  appendLog: (text: string, phase?: string) => void;
  setScanProgress: (progress: {
    status: string;
    phase?: string;
    gamesDone?: number;
    gamesTotal?: number;
    running?: boolean;
    log?: boolean;
  }) => void;
  clearLog: () => void;
};

const ScanLogContext = createContext<ScanLogContextValue | null>(null);
const MAX_LINES = 80;

export function ScanLogProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<ScanLogLine[]>([]);
  const [status, setStatus] = useState("Idle");
  const [phase, setPhase] = useState("idle");
  const [gamesDone, setGamesDone] = useState(0);
  const [gamesTotal, setGamesTotal] = useState(0);
  const [running, setRunning] = useState(false);
  const seq = React.useRef(0);

  const appendLog = useCallback((text: string, nextPhase?: string) => {
    const id = `l${++seq.current}`;
    setLines((prev) => {
      const next = [
        ...prev,
        { id, at: Date.now(), text, phase: nextPhase },
      ];
      return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next;
    });
    if (nextPhase) setPhase(nextPhase);
    setStatus(text);
  }, []);

  const setScanProgress = useCallback(
    (progress: {
      status: string;
      phase?: string;
      gamesDone?: number;
      gamesTotal?: number;
      running?: boolean;
      log?: boolean;
    }) => {
      setStatus(progress.status);
      if (progress.phase) setPhase(progress.phase);
      if (progress.gamesDone != null) setGamesDone(progress.gamesDone);
      if (progress.gamesTotal != null) setGamesTotal(progress.gamesTotal);
      if (progress.running != null) setRunning(progress.running);
      if (progress.log) appendLog(progress.status, progress.phase);
    },
    [appendLog]
  );

  const clearLog = useCallback(() => {
    setLines([]);
    setStatus("Idle");
    setPhase("idle");
    setGamesDone(0);
    setGamesTotal(0);
    setRunning(false);
  }, []);

  const value = useMemo(
    () => ({
      lines,
      status,
      phase,
      gamesDone,
      gamesTotal,
      running,
      appendLog,
      setScanProgress,
      clearLog,
    }),
    [
      lines,
      status,
      phase,
      gamesDone,
      gamesTotal,
      running,
      appendLog,
      setScanProgress,
      clearLog,
    ]
  );

  return (
    <ScanLogContext.Provider value={value}>{children}</ScanLogContext.Provider>
  );
}

export function useScanLog(): ScanLogContextValue {
  const ctx = useContext(ScanLogContext);
  if (!ctx) throw new Error("useScanLog must be used within ScanLogProvider");
  return ctx;
}
