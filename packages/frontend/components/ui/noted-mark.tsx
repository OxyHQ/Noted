import Svg, { Path } from "react-native-svg";

export interface NotedMarkProps {
  size?: number;
  /** Defaults to the current text colour so the mark follows the theme. */
  color?: string;
}

/**
 * The Noted logo mark, without the wordmark.
 *
 * For places too narrow to read a word — the collapsed sidebar is the one that
 * exists today. The full wordmark stays wherever there is room for it, since a
 * name is more recognisable than a glyph when both fit.
 *
 * Traced from `assets/logo-icon.svg`, which is the source the app icons were
 * generated from. The `fill` is deliberately NOT the `#e3e3e3` that file
 * carries: an exported asset bakes in whatever colour the exporter was set to,
 * and a mark that ignores the theme is invisible in one of the two.
 */
export function NotedMark({ size = 24, color = "currentColor" }: NotedMarkProps) {
  return (
    <Svg width={size} height={size} viewBox="0 -960 960 960" accessibilityRole="image">
      <Path
        fill={color}
        d="M263.12-119.73Q227-155.85 227-206.62t36.12-86.88q36.11-36.12 86.88-36.12 50.77 0 86.88 36.12Q473-257.39 473-206.62q0 50.77-36.12 86.89Q400.77-83.62 350-83.62q-50.77 0-86.88-36.11Zm303.65-142.89q-13.77-49-45.85-85.96-32.07-36.96-76.3-57.73l69.92-68.77H261q-33.15 0-56.08-23.69Q182-522.46 182-556q0-21.69 10.66-39.69 10.65-18 28.34-28.85l453.92-280.54q18.54-11.69 39.69-5.84 21.16 5.84 31.85 25.38 9.69 18.16 5.04 37.5-4.66 19.35-23.19 31.04L395.15-603H691q35.77 0 61.88 25.62Q779-551.77 779-516q0 18.08-7.23 34.35-7.23 16.26-18.69 27.73l-186.31 191.3Z"
      />
    </Svg>
  );
}
