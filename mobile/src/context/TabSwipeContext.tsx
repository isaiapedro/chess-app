import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { Animated } from "react-native";

type TabSwipeContextValue = {
  tabsLocked: boolean;
  setTabsLocked: (locked: boolean) => void;
  activeTabIndex: number;
  setActiveTabIndex: (index: number) => void;
  pageProgress: Animated.Value;
};

const TabSwipeContext = createContext<TabSwipeContextValue | null>(null);

export function TabSwipeProvider({ children }: { children: React.ReactNode }) {
  const [tabsLocked, setTabsLockedState] = useState(false);
  const [activeTabIndex, setActiveTabIndexState] = useState(0);
  const pageProgress = useRef(new Animated.Value(0)).current;
  const setTabsLocked = useCallback((locked: boolean) => {
    setTabsLockedState(locked);
  }, []);
  const setActiveTabIndex = useCallback((index: number) => {
    setActiveTabIndexState(index);
  }, []);
  const value = useMemo(
    () => ({
      tabsLocked,
      setTabsLocked,
      activeTabIndex,
      setActiveTabIndex,
      pageProgress,
    }),
    [tabsLocked, setTabsLocked, activeTabIndex, setActiveTabIndex, pageProgress]
  );
  return (
    <TabSwipeContext.Provider value={value}>{children}</TabSwipeContext.Provider>
  );
}

export function useTabSwipe(): TabSwipeContextValue {
  const ctx = useContext(TabSwipeContext);
  if (!ctx) throw new Error("useTabSwipe must be used within TabSwipeProvider");
  return ctx;
}
