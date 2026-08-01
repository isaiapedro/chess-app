import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import PagerView from "react-native-pager-view";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { RecapScreen } from "../screens/RecapScreen";
import { InsightsScreen } from "../screens/InsightsScreen";
import { StudyScreen } from "../screens/StudyScreen";
import { ProfileScreen } from "../screens/ProfileScreen";
import { colors } from "../theme";

const TAB_ORDER = ["Wrapped", "Insights", "Study", "Profile"] as const;
const TAB_BAR_PADDING = 6;
const TAB_GAP = 10;
const TAB_PILL_SCALE = 0.9;
const TAB_PILL_DELAY_MS = 80;
const TAB_PILL_DURATION_MS = 180;

type TabName = (typeof TAB_ORDER)[number];

const TAB_ICONS: Record<TabName, keyof typeof Ionicons.glyphMap> = {
  Wrapped: "sync-outline",
  Insights: "bar-chart-outline",
  Study: "school-outline",
  Profile: "person-outline",
};

export function TabNavigator() {
  const pagerRef = useRef<PagerView>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [tabBarWidth, setTabBarWidth] = useState(0);
  const pillX = useRef(new Animated.Value(0)).current;
  const measuredWidthRef = useRef(0);
  const insets = useSafeAreaInsets();

  const openPage = (index: number) => {
    setActiveIndex(index);
    pagerRef.current?.setPage(index);
  };

  const tabWidth =
    tabBarWidth > 0
      ? (tabBarWidth - TAB_BAR_PADDING * 2 - TAB_GAP * (TAB_ORDER.length - 1)) /
        TAB_ORDER.length
      : 0;
  const pillWidth = tabWidth * TAB_PILL_SCALE;

  useEffect(() => {
    if (!tabBarWidth) return;
    const target =
      TAB_BAR_PADDING +
      activeIndex * (tabWidth + TAB_GAP) +
      (tabWidth - pillWidth) / 2;

    if (measuredWidthRef.current !== tabBarWidth) {
      measuredWidthRef.current = tabBarWidth;
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
  }, [activeIndex, pillWidth, pillX, tabBarWidth, tabWidth]);

  return (
    <View style={styles.container}>
      <PagerView
        ref={pagerRef}
        style={styles.pager}
        initialPage={0}
        overdrag
        onPageSelected={(event) => setActiveIndex(event.nativeEvent.position)}
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
          onLayout={(event) => setTabBarWidth(event.nativeEvent.layout.width)}
          accessibilityRole="tablist"
        >
          {pillWidth > 0 ? (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.tabActive,
                {
                  width: pillWidth,
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
    height: 46,
    alignItems: "center",
    justifyContent: "center",
  },
  tabPill: {
    width: "90%",
    height: 41.4,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 23.4,
  },
  tabActive: {
    position: "absolute",
    top: TAB_BAR_PADDING,
    left: 0,
    height: 41.4,
    borderRadius: 23.4,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
  },
});
