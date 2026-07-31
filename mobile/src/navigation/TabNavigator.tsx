import React from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import { RecapScreen } from "../screens/RecapScreen";
import { InsightsScreen } from "../screens/InsightsScreen";
import { StudyScreen } from "../screens/StudyScreen";
import { colors, font } from "../theme";

export type RootTabParamList = {
  Wrapped: undefined;
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
          backgroundColor: colors.bg,
          borderTopColor: colors.text,
          borderTopWidth: 2,
          height: 64,
          paddingTop: 6,
        },
        tabBarActiveTintColor: colors.red,
        tabBarInactiveTintColor: colors.textDim,
        tabBarLabelStyle: {
          fontFamily: font.monoBold,
          fontSize: 11,
          letterSpacing: 1,
          textTransform: "uppercase",
        },
        tabBarIcon: ({ color, size }) => {
          const map: Record<keyof RootTabParamList, keyof typeof Ionicons.glyphMap> = {
            Wrapped: "star-outline",
            Insights: "bar-chart-outline",
            Study: "school-outline",
          };
          return <Ionicons name={map[route.name]} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Wrapped" component={RecapScreen} />
      <Tab.Screen name="Insights" component={InsightsScreen} />
      <Tab.Screen name="Study" component={StudyScreen} />
    </Tab.Navigator>
  );
}
