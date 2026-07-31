import React from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import { RecapScreen } from "../screens/RecapScreen";
import { InsightsScreen } from "../screens/InsightsScreen";
import { StudyScreen } from "../screens/StudyScreen";
import { ProfileScreen } from "../screens/ProfileScreen";
import { colors, font } from "../theme";

export type RootTabParamList = {
  Wrapped: undefined;
  Insights: undefined;
  Study: undefined;
  Profile: undefined;
};

const Tab = createBottomTabNavigator<RootTabParamList>();

export function TabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.bg,
          borderTopColor: colors.text,
          borderTopWidth: 2,
          paddingTop: 4,
          paddingBottom: 8,
          minHeight: 56,
        },
        tabBarItemStyle: {
          paddingBottom: 2,
        },
        tabBarActiveTintColor: colors.red,
        tabBarInactiveTintColor: colors.textDim,
        tabBarLabelStyle: {
          fontFamily: font.monoBold,
          fontSize: 9,
          letterSpacing: 0.5,
          textTransform: "uppercase",
          marginBottom: 2,
        },
        tabBarIcon: ({ color }) => {
          const map: Record<keyof RootTabParamList, keyof typeof Ionicons.glyphMap> = {
            Wrapped: "star-outline",
            Insights: "bar-chart-outline",
            Study: "school-outline",
            Profile: "person-outline",
          };
          return <Ionicons name={map[route.name]} size={18} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Wrapped" component={RecapScreen} />
      <Tab.Screen name="Insights" component={InsightsScreen} />
      <Tab.Screen name="Study" component={StudyScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}
