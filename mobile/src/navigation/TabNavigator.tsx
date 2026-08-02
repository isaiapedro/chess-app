import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import PagerView from "react-native-pager-view";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTabSwipe } from "../context/TabSwipeContext";
import { RecapScreen } from "../screens/RecapScreen";
import { InsightsScreen } from "../screens/InsightsScreen";
import { StudyScreen } from "../screens/StudyScreen";
import { ProfileScreen } from "../screens/ProfileScreen";
import { colors } from "../theme";

const TAB_ORDER = ["Wrapped", "Insights", "Study", "Profile"] as const;
const TAB_BAR_PADDING = 6;
const TAB_GAP = 10;
const TAB_PILL_SCALE = 0.945;
const TAB_PILL_HEIGHT = 43.47;
const TAB_PILL_RADIUS = 24.57;
const TAB_SLOT_HEIGHT = 46;
const TAB_PILL_DELAY_MS = 36;
const TAB_PILL_DURATION_MS = 71;

type TabName = (typeof TAB_ORDER)[number];

type TabFrame = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const TAB_ICONS: Record<TabName, keyof typeof Ionicons.glyphMap> = {
  Wrapped: "sync-outline",
  Insights: "bar-chart-outline",
  Study: "school-outline",
  Profile: "person-outline",
};

export function TabNavigator() {
  const pagerRef = useRef<PagerView>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [tabFrames, setTabFrames] = useState<TabFrame[]>([]);
  const pillX = useRef(new Animated.Value(0)).current;
  const readyRef = useRef(false);
  const insets = useSafeAreaInsets();
  const { setActiveTabIndex, pageProgress } = useTabSwipe();
  const openPage = (index: number) => {
    setActiveIndex(index);
    setActiveTabIndex(index);
    pagerRef.current?.setPage(index);
  };

  useEffect(() => {
    setActiveTabIndex(activeIndex);
  }, [activeIndex, setActiveTabIndex]);

  const activeFrame = tabFrames[activeIndex];
  const pillWidth = activeFrame ? activeFrame.width * TAB_PILL_SCALE : 0;
  const pillTop = activeFrame
    ? activeFrame.y + (activeFrame.height - TAB_PILL_HEIGHT) / 2
    : TAB_BAR_PADDING + (TAB_SLOT_HEIGHT - TAB_PILL_HEIGHT) / 2;

  useEffect(() => {
    if (!activeFrame || pillWidth <= 0) return;
    const target = activeFrame.x + (activeFrame.width - pillWidth) / 2;

    if (!readyRef.current) {
      readyRef.current = true;
      pillX.setValue(target);
      return;
    }

    const animation = Animated.sequence([
      Animated.delay(TAB_PILL_DELAY_MS),
      Animated.timing(pillX, {
        toValue: target,
        duration: TAB_PILL_DURATION_MS,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [activeFrame, activeIndex, pillWidth, pillX]);

  const onTabLayout = (
    index: number,
    x: number,
    y: number,
    width: number,
    height: number
  ) => {
    setTabFrames((prev) => {
      const current = prev[index];
      if (
        current &&
        current.x === x &&
        current.y === y &&
        current.width === width &&
        current.height === height
      ) {
        return prev;
      }
      const next = prev.slice();
      next[index] = { x, y, width, height };
      return next;
    });
  };

  return (
    <View style={styles.container}>
      <PagerView
        ref={pagerRef}
        style={styles.pager}
        initialPage={0}
        overdrag
        scrollEnabled
        onPageScroll={(event) => {
          const { position, offset } = event.nativeEvent;
          pageProgress.setValue(position + offset);
        }}
        onPageSelected={(event) => {
          const position = event.nativeEvent.position;
          setActiveIndex(position);
          pageProgress.setValue(position);
        }}
      >
        <View key="Wrapped" style={styles.page}>
          <RecapScreen />
        </View>
        <View key="Insights" style={styles.page}>
          <InsightsScreen />
        </View>
        <View key="Study" style={styles.page}>
          <StudyScreen />
        </View>
        <View key="Profile" style={styles.page}>
          <ProfileScreen />
        </View>
      </PagerView>

      <View
        style={[
          styles.tabBarPosition,
          {
            bottom: Math.max(insets.bottom, 12),
          },
        ]}
      >
        <BlurView
          intensity={42}
          tint="dark"
          experimentalBlurMethod="dimezisBlurView"
          style={styles.tabBar}
          accessibilityRole="tablist"
        >
          {pillWidth > 0 ? (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.tabActive,
                {
                  width: pillWidth,
                  top: pillTop,
                  transform: [{ translateX: pillX }],
                },
              ]}
            />
          ) : null}
          {TAB_ORDER.map((name, index) => {
            const active = index === activeIndex;
            return (
              <Pressable
                key={name}
                style={styles.tab}
                onLayout={(event) => {
                  const { x, y, width, height } = event.nativeEvent.layout;
                  onTabLayout(index, x, y, width, height);
                }}
                onPress={() => openPage(index)}
                accessibilityLabel={name === "Wrapped" ? "Recap" : name}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
              >
                <View style={styles.tabPill}>
                  <Ionicons
                    name={TAB_ICONS[name]}
                    size={26.4}
                    color={active ? colors.text : colors.textDim}
                  />
                </View>
              </Pressable>
            );
          })}
        </BlurView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  pager: {
    flex: 1,
  },
  page: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  tabBarPosition: {
    position: "absolute",
    left: 30,
    right: 30,
    zIndex: 20,
    shadowColor: "#000000",
    shadowOpacity: 0.32,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  tabBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: TAB_GAP,
    padding: TAB_BAR_PADDING,
    borderRadius: 32,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(18,18,18,0.56)",
    overflow: "hidden",
  },
  tab: {
    flex: 1,
    height: TAB_SLOT_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
  },
  tabPill: {
    width: "94.5%",
    height: TAB_PILL_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: TAB_PILL_RADIUS,
  },
  tabActive: {
    position: "absolute",
    left: 0,
    height: TAB_PILL_HEIGHT,
    borderRadius: TAB_PILL_RADIUS,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
  },
});
