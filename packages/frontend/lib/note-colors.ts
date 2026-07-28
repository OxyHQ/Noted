import { APP_COLOR_PRESETS, getPresetVars, type AppColorName } from "@oxyhq/bloom/theme";
import type { NoteColor } from "@noted/shared-types";

/**
 * Per-note background + border colors, derived from the canonical Bloom color
 * system (`@oxyhq/bloom/theme`).
 *
 * The 11 non-`default` note colors ARE the standard (non-premium) Bloom preset
 * names, so instead of shipping a hand-tuned hex palette we resolve each preset
 * through Bloom's own token engine and reuse the result as a soft per-note tint:
 *
 *   - Card background → the preset's `--surface` token (a soft, low-saturation
 *     tint of the hue). Text stays on the theme `foreground` token, which Bloom
 *     tunes to read on `--surface` in both modes, so contrast/readability is
 *     preserved.
 *   - Card border → the preset's `--border` token (a touch darker than the
 *     surface at the same hue).
 *   - Swatch dot → the preset's identity `hex` (the saturated brand color), so
 *     the picker reads as the recognisable Bloom hue rather than the soft tint.
 *
 * `getPresetVars` returns full CSS colors (`rgb(...)`), so the values are used
 * as-is. `default` returns `null`, meaning "use the theme card token" (so
 * default notes follow the app surface in both modes).
 */

export interface NoteColorTint {
  /** Card background (soft tint of the preset hue). */
  background: string;
  /** Card border (slightly darker than the background, same hue). */
  border: string;
}

type Scheme = "light" | "dark";

/**
 * Resolve a note color to the Bloom preset name that backs it, or `null` for
 * `default` / any value not in the standard Bloom palette (caller falls back to
 * the theme card token). The 11 non-`default` colors are exactly the standard
 * Bloom names, so this lookup is total in practice; the guard keeps it type-safe
 * and tolerant of unexpected stored values.
 */
function presetNameFor(color: NoteColor): AppColorName | null {
  if (color === "default") return null;
  const name = color as AppColorName;
  return APP_COLOR_PRESETS[name] ? name : null;
}

/**
 * `getPresetVars` runs Bloom's full role-derivation engine, and every note card
 * asks for its tint on each render. The output is a pure function of
 * (preset, scheme) over at most 13 × 2 combinations, so resolve each once.
 */
const tintCache = new Map<string, NoteColorTint>();

/**
 * Resolve a note color to a concrete tint, or `null` for `default`
 * (caller should fall back to the theme card token).
 */
export function getNoteColorTint(color: NoteColor, scheme: Scheme): NoteColorTint | null {
  const name = presetNameFor(color);
  if (!name) return null;
  const key = `${name}:${scheme}`;
  const cached = tintCache.get(key);
  if (cached) return cached;
  const tokens = getPresetVars(name, scheme);
  const tint: NoteColorTint = {
    background: tokens["--surface"],
    border: tokens["--border"],
  };
  tintCache.set(key, tint);
  return tint;
}

/**
 * Solid swatch color for the color-picker dots — the preset's saturated
 * identity hex, so the picker reads as the recognisable Bloom hue. Returns
 * `null` for `default` (rendered as a bordered theme-card dot).
 */
export function getNoteColorSwatch(color: NoteColor, _scheme: Scheme): string | null {
  const name = presetNameFor(color);
  return name ? APP_COLOR_PRESETS[name].hex : null;
}
