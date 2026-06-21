import { APP_COLOR_PRESETS, type AppColorName } from "@oxyhq/bloom/theme";
import type { NoteColor } from "@/lib/types/note";

/**
 * Per-note background + border colors, derived from the canonical Bloom color
 * system (`@oxyhq/bloom/theme` `APP_COLOR_PRESETS`).
 *
 * The 11 non-`default` note colors ARE the standard (non-premium) Bloom preset
 * names, so instead of shipping a hand-tuned hex palette we read each preset's
 * designer-authored tokens and reuse them as a soft per-note tint:
 *
 *   - Card background → the preset's `--surface` token (a soft, low-saturation
 *     tint of the hue: `H 58% 94%` in light, `H 20% 18%` in dark). Text stays
 *     on the theme `foreground` token, which Bloom tunes to read on `--surface`
 *     in both modes, so contrast/readability is preserved.
 *   - Card border → the preset's `--border` token (a touch darker than the
 *     surface at the same hue: `H 40% 87%` light, `H 12% 20%` dark).
 *   - Swatch dot → the preset's identity `hex` (the saturated brand color), so
 *     the picker reads as the recognisable Bloom hue rather than the soft tint.
 *
 * The preset tokens are raw HSL triples (e.g. `'46 58% 94%'`), so they are
 * wrapped in `hsl(...)` here. `default` returns `null`, meaning "use the theme
 * card token" (so default notes follow the app surface in both modes).
 */

export interface NoteColorTint {
  /** Card background (soft tint of the preset hue). */
  background: string;
  /** Card border (slightly darker than the background, same hue). */
  border: string;
}

type Scheme = "light" | "dark";

/** Wrap a Bloom raw HSL triple (e.g. `'46 58% 94%'`) in a CSS `hsl(...)`. */
function hsl(triple: string): string {
  return `hsl(${triple})`;
}

/**
 * Resolve a note color to the Bloom preset that backs it, or `null` for
 * `default` / any value not in the standard Bloom palette (caller falls back to
 * the theme card token). The 11 non-`default` colors are exactly the standard
 * Bloom names, so this lookup is total in practice; the guard keeps it type-safe
 * and tolerant of unexpected stored values.
 */
function presetFor(color: NoteColor) {
  if (color === "default") return null;
  return APP_COLOR_PRESETS[color as AppColorName] ?? null;
}

/**
 * Resolve a note color to a concrete tint, or `null` for `default`
 * (caller should fall back to the theme card token).
 */
export function getNoteColorTint(color: NoteColor, scheme: Scheme): NoteColorTint | null {
  const preset = presetFor(color);
  if (!preset) return null;
  const tokens = scheme === "dark" ? preset.dark : preset.light;
  return {
    background: hsl(tokens["--surface"]),
    border: hsl(tokens["--border"]),
  };
}

/**
 * Solid swatch color for the color-picker dots — the preset's saturated
 * identity hex, so the picker reads as the recognisable Bloom hue. Returns
 * `null` for `default` (rendered as a bordered theme-card dot).
 */
export function getNoteColorSwatch(color: NoteColor, _scheme: Scheme): string | null {
  const preset = presetFor(color);
  return preset ? preset.hex : null;
}
