import type { NoteColor } from "@/lib/types/note";

/**
 * Per-note background + border colors, Google-Keep style.
 *
 * Keep applies a fixed tint per color that reads well on both light and dark
 * canvases, so we ship a light and a dark variant for each note color and pick
 * based on the active color scheme. `default` returns `null`, meaning "use the
 * theme card token" (so default notes follow the app surface in both modes).
 *
 * Values are intentionally concrete colors (not theme tokens) because the whole
 * point of a per-note color is a tint that is independent of the accent theme —
 * this is the one place hardcoded note tints are correct. The text color stays
 * on the theme `foreground` token in every case for contrast/readability.
 */

export interface NoteColorTint {
  /** Card background. */
  background: string;
  /** Card border (slightly darker than the background). */
  border: string;
}

type Scheme = "light" | "dark";

const LIGHT: Record<Exclude<NoteColor, "default">, NoteColorTint> = {
  red: { background: "#faafa8", border: "#f2938a" },
  orange: { background: "#f39f76", border: "#e98a5c" },
  yellow: { background: "#fff8b8", border: "#f7ec80" },
  green: { background: "#e2f6d3", border: "#cbeeb4" },
  teal: { background: "#b4ddd3", border: "#97cdbf" },
  blue: { background: "#d4e4ed", border: "#b8d2e0" },
  darkblue: { background: "#aeccdc", border: "#8fb8cd" },
  purple: { background: "#d3bfdb", border: "#bfa3cc" },
  pink: { background: "#f6e2dd", border: "#eecabf" },
  brown: { background: "#e9e3d4", border: "#d8cfba" },
  gray: { background: "#efeff1", border: "#dcdce0" },
};

const DARK: Record<Exclude<NoteColor, "default">, NoteColorTint> = {
  red: { background: "#77172e", border: "#8f2438" },
  orange: { background: "#692b17", border: "#823620" },
  yellow: { background: "#7c4a03", border: "#965c0d" },
  green: { background: "#264d3b", border: "#33614b" },
  teal: { background: "#0c625d", border: "#147972" },
  blue: { background: "#256377", border: "#2f7990" },
  darkblue: { background: "#284255", border: "#34556e" },
  purple: { background: "#472e5b", border: "#5b3c73" },
  pink: { background: "#6c394f", border: "#854864" },
  brown: { background: "#4b443a", border: "#5e564a" },
  gray: { background: "#232427", border: "#34363a" },
};

/**
 * Resolve a note color to a concrete tint, or `null` for `default`
 * (caller should fall back to the theme card token).
 */
export function getNoteColorTint(color: NoteColor, scheme: Scheme): NoteColorTint | null {
  if (color === "default") return null;
  return (scheme === "dark" ? DARK : LIGHT)[color];
}

/** Solid swatch color for the color-picker dots (uses the light tint). */
export function getNoteColorSwatch(color: NoteColor, scheme: Scheme): string | null {
  if (color === "default") return null;
  return (scheme === "dark" ? DARK : LIGHT)[color].background;
}
