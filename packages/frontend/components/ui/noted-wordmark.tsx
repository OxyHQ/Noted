import { Text as RNText } from "react-native";
import { useColorScheme } from "@/lib/useColorScheme";

export interface NotedWordmarkProps {
  width?: number;
  height?: number;
  color?: string;
}

/**
 * Noted brand wordmark.
 *
 * Rendered as styled text in the app's brand font (Inter) rather than a
 * hand-traced SVG so it stays crisp at any size and inherits theme colors.
 * `width` controls the font size (the wordmark is ~3.4x as wide as tall, so
 * the type scale is derived from the requested width to keep callers' sizing
 * expectations roughly intact).
 */
export function NotedWordmark({ width = 96, height, color }: NotedWordmarkProps) {
  const { colors } = useColorScheme();
  const fill = color ?? colors.foreground;

  // Approximate the wordmark height from the requested width (logo aspect ~3.4:1)
  // and use it as the font size; callers that pass `height` get it directly.
  const fontSize = height ?? Math.round(width / 3.4);

  return (
    <RNText
      accessibilityRole="header"
      style={{
        fontFamily: "Inter",
        fontWeight: "700",
        fontSize,
        lineHeight: Math.round(fontSize * 1.1),
        letterSpacing: -fontSize * 0.03,
        color: fill,
      }}
    >
      Noted
    </RNText>
  );
}
