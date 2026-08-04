import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Constants from "expo-constants";
import { selectMetricsCatalog } from "../api/selectors";
import type { CatalogMetric, CatalogSection, InsightsResponse } from "../api/types";
import { countOpeningCatalogBanners } from "../components/OpeningInsightsPanel";
import { countMiddlegameCatalogBanners } from "../components/MiddlegameInsightsPanel";
import { useAnalytics } from "../context/AnalyticsContext";
import { StyleOfPlayPanel } from "../components/StyleOfPlayPanel";
import { OpeningInsightsPanel } from "../components/OpeningInsightsPanel";
import { MiddlegameInsightsPanel } from "../components/MiddlegameInsightsPanel";
import { EndgameInsightsPanel } from "../components/EndgameInsightsPanel";
import {
  BackLink,
  DisplayTitle,
  EdgeCard,
  SearchField,
  SectionLabel,
} from "../components/ui";
import { useInsightsNav } from "../context/InsightsNavContext";
import { colors, font, radius, result, spacing, type, withAlpha } from "../theme";

type Props = {
  data: InsightsResponse;
  onBack: () => void;
};

const FADE_OUT_MS = 160;
const FADE_IN_MS = 240;

function debugNavLog(message: string, data: Record<string, unknown>) {
  // #region agent log
  const hostUri =
    Constants.expoConfig?.hostUri ||
    Constants.linkingUri?.replace(/^exp:\/\//, "").replace(/\/.*$/, "");
  const host = hostUri?.split(":")[0] || "127.0.0.1";
  fetch(`http://${host}:7677/ingest/217f9228-6275-432a-b240-b52166a932e5`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "6d2375",
    },
    body: JSON.stringify({
      sessionId: "6d2375",
      runId: "insights-nav",
      hypothesisId: "H-nav",
      location: "CatalogScreen.tsx",
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
}

export function CatalogScreen({ data, onBack }: Props) {
  const [search, setSearch] = useState("");
  const [activeSection, setActiveSection] = useState<CatalogSection["key"] | null>(
    null
  );
  const { openingPhase, middlegamePhase } = useAnalytics();
  const sections = useMemo(() => selectMetricsCatalog(data), [data]);
  const openingBannerCount = useMemo(
    () => countOpeningCatalogBanners(openingPhase),
    [openingPhase]
  );
  const middlegameBannerCount = useMemo(
    () => countMiddlegameCatalogBanners(middlegamePhase),
    [middlegamePhase]
  );
  const { setDepth, registerPopHandler } = useInsightsNav();
  const activeSectionRef = useRef(activeSection);
  const onBackRef = useRef(onBack);
  const contentOpacity = useRef(new Animated.Value(0)).current;
  const transitioningRef = useRef(false);
  activeSectionRef.current = activeSection;
  onBackRef.current = onBack;

  useEffect(() => {
    contentOpacity.setValue(0);
    Animated.timing(contentOpacity, {
      toValue: 1,
      duration: FADE_IN_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [contentOpacity]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return sections
      .map((section) => ({
        ...section,
        metrics: section.metrics.filter(
          (metric) =>
            metric.name.toLowerCase().includes(q) ||
            metric.desc.toLowerCase().includes(q)
        ),
      }))
      .filter((section) => section.metrics.length > 0);
  }, [sections, search]);

  const activeMetrics = useMemo(() => {
    if (!activeSection) return null;
    return sections.find((section) => section.key === activeSection) || null;
  }, [sections, activeSection]);

  const current = activeSection
    ? sections.find((section) => section.key === activeSection)
    : null;
  const searching = !activeSection && search.trim().length > 0;

  const runFadeTransition = (
    apply: () => void,
    options: { fadeIn: boolean; leave?: boolean }
  ) => {
    if (transitioningRef.current) return false;
    transitioningRef.current = true;
    Animated.timing(contentOpacity, {
      toValue: 0,
      duration: FADE_OUT_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) {
        transitioningRef.current = false;
        return;
      }
      apply();
      if (options.leave || !options.fadeIn) {
        transitioningRef.current = false;
        return;
      }
      contentOpacity.setValue(0);
      requestAnimationFrame(() => {
        Animated.timing(contentOpacity, {
          toValue: 1,
          duration: FADE_IN_MS,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start(() => {
          transitioningRef.current = false;
        });
      });
    });
    return true;
  };

  const finishPopRef = useRef(() => false);
  finishPopRef.current = () => {
    if (activeSectionRef.current) {
      debugNavLog("pop to metrics catalog", {
        from: activeSectionRef.current,
      });
      return runFadeTransition(
        () => {
          setActiveSection(null);
          setSearch("");
        },
        { fadeIn: true }
      );
    }
    debugNavLog("pop to performance analysis", {});
    return runFadeTransition(
      () => {
        onBackRef.current();
      },
      { fadeIn: false, leave: true }
    );
  };

  const animatePopRef = useRef(() => false);
  animatePopRef.current = () => finishPopRef.current();

  useEffect(() => {
    const depth = activeSection ? 2 : 1;
    setDepth(depth);
    registerPopHandler(() => animatePopRef.current());
    debugNavLog("catalog depth", { depth, section: activeSection });
    return () => {
      registerPopHandler(null);
    };
  }, [activeSection, setDepth, registerPopHandler]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_evt, gesture) =>
        gesture.dx > 16 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.35,
      onPanResponderRelease: (_evt, gesture) => {
        const shouldPop = gesture.dx > 96 || gesture.vx > 0.55;
        if (shouldPop) {
          debugNavLog("swipe right pop", {
            dx: gesture.dx,
            section: activeSectionRef.current,
          });
          animatePopRef.current();
        }
      },
    })
  ).current;

  const openSection = (key: CatalogSection["key"]) => {
    runFadeTransition(
      () => {
        setSearch("");
        setActiveSection(key);
      },
      { fadeIn: true }
    );
  };

  const categoriesBody = (
    <>
      {!searching ? (
        <View style={styles.pad}>
          <SectionLabel>Categories</SectionLabel>
          <View style={styles.grid}>
            {sections.map((section) => (
              <Pressable
                key={section.key}
                onPress={() => openSection(section.key)}
                style={({ pressed }) => [
                  styles.categoryCard,
                  pressed && styles.categoryCardPressed,
                ]}
              >
                <Text style={[styles.categoryIcon, { color: section.color }]}>
                  {section.icon}
                </Text>
                <Text style={styles.categoryTitle}>{section.title}</Text>
                <Text style={styles.categoryMeta}>
                  {section.key === "openings"
                    ? `${Math.max(openingBannerCount, section.metrics.length)} metrics`
                    : section.key === "middlegame"
                      ? `${Math.max(middlegameBannerCount, section.metrics.length)} metrics`
                      : `${section.metrics.length} metrics`}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : !filtered.length ? (
        <View style={styles.pad}>
          <Text style={styles.empty}>No metrics found for "{search}"</Text>
        </View>
      ) : (
        <View style={styles.pad}>
          {filtered.map((section) => (
            <View key={section.key} style={{ marginBottom: spacing.md }}>
              <View style={styles.sectionHead}>
                <Text style={styles.sectionTitle}>{section.title}</Text>
                <View
                  style={[
                    styles.sectionUnderline,
                    { backgroundColor: section.color },
                  ]}
                />
              </View>
              {section.metrics.map((metric) => (
                <MetricCard key={metric.id} metric={metric} />
              ))}
            </View>
          ))}
        </View>
      )}
    </>
  );

  const detailBody = (
    <View style={styles.pad}>
      {activeSection === "style" ? (
        <StyleOfPlayPanel />
      ) : activeSection === "openings" ? (
        <OpeningInsightsPanel />
      ) : activeSection === "middlegame" ? (
        <MiddlegameInsightsPanel />
      ) : activeSection === "endgame" ? (
        <EndgameInsightsPanel />
      ) : activeMetrics ? (
        activeMetrics.metrics.map((metric) => (
          <MetricCard key={metric.id} metric={metric} />
        ))
      ) : null}
    </View>
  );

  return (
    <View style={styles.root} {...panResponder.panHandlers}>
      <Animated.View style={[styles.sheet, { opacity: contentOpacity }]}>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <BackLink
              label={activeSection ? "All categories" : "Insights"}
              onPress={() => {
                animatePopRef.current();
              }}
            />
            <DisplayTitle size={30}>
              {current?.title || "Metrics"}
            </DisplayTitle>
            {!activeSection ? (
              <>
                <View style={{ height: spacing.md }} />
                <SearchField
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Search metrics..."
                />
              </>
            ) : null}
          </View>
          {activeSection ? detailBody : categoriesBody}
        </ScrollView>
      </Animated.View>
    </View>
  );
}

function MetricCard({ metric }: { metric: CatalogMetric }) {
  return (
    <EdgeCard style={{ marginBottom: spacing.sm }}>
      <Text style={styles.metricName}>{metric.name}</Text>
      <Text style={styles.metricValue}>
        {metric.value}
        <Text style={styles.metricUnit}>{metric.unit}</Text>
      </Text>
      <Text style={styles.metricDesc}>{metric.desc}</Text>
      {metric.numericValue != null ? (
        <View style={styles.barTrack}>
          <View
            style={[
              styles.barFill,
              {
                width: `${Math.min(100, Math.abs(metric.numericValue))}%`,
                backgroundColor: result.win,
              },
            ]}
          />
        </View>
      ) : null}
    </EdgeCard>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  sheet: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scroll: { flex: 1, backgroundColor: colors.bg },
  content: { paddingBottom: 100 },
  header: { padding: spacing.md, paddingTop: spacing.md },
  pad: { paddingHorizontal: spacing.md },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  categoryCard: {
    width: "48%",
    flexGrow: 1,
    minWidth: "46%",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    paddingVertical: spacing.lg,
  },
  categoryCardPressed: { opacity: 0.6 },
  categoryIcon: { fontSize: 24, marginBottom: spacing.sm },
  categoryTitle: {
    ...type.subheading,
    fontFamily: font.sansBold,
    color: colors.text,
    marginBottom: 2,
  },
  categoryMeta: {
    ...type.caption,
    color: colors.textDim,
  },
  empty: {
    ...type.body,
    color: colors.textDim,
    textAlign: "center",
    marginTop: spacing.xl,
  },
  sectionHead: {
    alignItems: "flex-start",
    gap: 6,
    marginBottom: spacing.md,
  },
  sectionTitle: {
    ...type.heading,
    color: colors.text,
  },
  sectionUnderline: {
    height: 2,
    width: 28,
    borderRadius: radius.pill,
  },
  metricName: {
    ...type.label,
    color: colors.textMuted,
    marginBottom: 4,
  },
  metricValue: {
    ...type.numberSm,
    color: colors.text,
    marginBottom: 6,
  },
  metricUnit: {
    ...type.caption,
    color: colors.textMuted,
  },
  metricDesc: {
    ...type.bodySmall,
    color: colors.textDim,
  },
  barTrack: {
    marginTop: spacing.md,
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: withAlpha("#ffffff", 0.08),
    overflow: "hidden",
  },
  barFill: { height: 6, borderRadius: radius.pill },
});
