import React from "react";
import type { LucideIcon, LucideProps } from "lucide-react-native";

export const STROKE_LIGHT = 1.5;
export const STROKE_BOLD = 2.5;

type AppIconProps = Omit<LucideProps, "ref"> & {
  icon: LucideIcon;
  bold?: boolean;
};

export function AppIcon({
  icon: Icon,
  bold = false,
  size = 24,
  color,
  strokeWidth,
  ...rest
}: AppIconProps) {
  return (
    <Icon
      size={size}
      color={color}
      strokeWidth={strokeWidth ?? (bold ? STROKE_BOLD : STROKE_LIGHT)}
      {...rest}
    />
  );
}
