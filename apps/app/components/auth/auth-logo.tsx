import * as React from "react";
import { View } from "react-native";
import { cn } from "@/lib/utils";
import { NotedWordmark } from "@/components/ui/noted-wordmark";

export interface AuthLogoProps {
  className?: string;
}

export function AuthLogo({ className }: AuthLogoProps) {
  return (
    <View className={cn("items-center mb-6", className)}>
      <NotedWordmark width={160} />
    </View>
  );
}
