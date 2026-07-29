import React from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import { RecapScreen } from "../screens/RecapScreen";
import { InsightsScreen } from "../screens/InsightsScreen";
import { StudyScreen } from "../screens/StudyScreen";
import { colors } from "../theme";

export type RootTabParamList = {
  Recap: undefined;
  Insights: undefined;
  Study: undefined;
};

const Tab = createBottomTabNavigator<RootTabParamList>();

export function TabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarIcon: ({ color, size }) => {
          const map: Record<keyof RootTabParamList, keyof typeof Ionicons.glyphMap> = {
            Recap: "trophy-outline",
            Insights: "analytics-outline",
            Study: "school-outline",
          };
          return (
            <Ionicons name={map[route.name]} size={size} color={color} />
          );
        },
      })}
    >
      <Tab.Screen name="Recap" component={RecapScreen} />
      <Tab.Screen name="Insights" component={InsightsScreen} />
      <Tab.Screen name="Study" component={StudyScreen} />
    </Tab.Navigator>
  );
}
