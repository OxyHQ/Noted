import Svg, { Path } from "react-native-svg";

export interface NavIconProps {
  size?: number;
  /** Defaults to the current text colour so the icon follows the theme. */
  color?: string;
}

/**
 * The two sidebar destinations Material Symbols says it better than Lucide.
 *
 * Traced from the Material Symbols exports rather than imported as assets: an
 * exported `.svg` bakes in whatever colour the exporter was set to (`#e3e3e3`
 * here), and an icon that ignores the theme is invisible in one of the two.
 * Same reasoning, and the same `0 -960 960 960` viewBox, as `NotedMark`.
 */
export function StickyNoteIcon({ size = 24, color = "currentColor" }: NavIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 -960 960 960" accessibilityRole="image">
      <Path
        fill={color}
        d="M200-200h360v-160q0-17 11.5-28.5T600-400h160v-360H200v560Zm0 80q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v367q0 16-6 30.5T817-337L623-143q-11 11-25.5 17t-30.5 6H200Zm240-280H320q-17 0-28.5-11.5T280-440q0-17 11.5-28.5T320-480h120q17 0 28.5 11.5T480-440q0 17-11.5 28.5T440-400Zm200-160H320q-17 0-28.5-11.5T280-600q0-17 11.5-28.5T320-640h320q17 0 28.5 11.5T680-600q0 17-11.5 28.5T640-560ZM200-200v-560 560Z"
      />
    </Svg>
  );
}

export function AddTaskIcon({ size = 24, color = "currentColor" }: NavIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 -960 960 960" accessibilityRole="image">
      <Path
        fill={color}
        d="M480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q48 0 93.5 11t87.5 32q15 8 19.5 24t-5.5 30q-10 14-26.5 18t-32.5-4q-32-15-66.5-23t-69.5-8q-134 0-227 93t-93 227q0 134 93 227t227 93q26 0 51-4t50-12q17-5 33-.5t25 19.5q8 14 3.5 30T622-105q-34 13-70 19t-72 6Zm280-200h-80q-17 0-28.5-11.5T640-320q0-17 11.5-28.5T680-360h80v-80q0-17 11.5-28.5T800-480q17 0 28.5 11.5T840-440v80h80q17 0 28.5 11.5T960-320q0 17-11.5 28.5T920-280h-80v80q0 17-11.5 28.5T800-160q-17 0-28.5-11.5T760-200v-80ZM424-408l372-373q11-11 28-11t28 11q11 11 11 28t-11 28L452-324q-12 12-28 12t-28-12L282-438q-11-11-11-28t11-28q11-11 28-11t28 11l86 86Z"
      />
    </Svg>
  );
}
