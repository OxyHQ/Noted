/**
 * Reading a note written before the document model existed.
 *
 * A stored artifact holds `sections[].items` — an array of short lines — and the
 * domain now holds `sections[].blocks`. The conversion happens on read, at the
 * repository boundary, and it lives here rather than there so it can be tested
 * without a database.
 *
 * "Artifacts are rebuildable" is not an answer. One CAN be regenerated from a
 * transcript, and for a capture whose audio and transcript have since been
 * deleted there is nothing left to regenerate from — that row IS the note, and
 * dropping it would be deleting somebody's note during an upgrade.
 */

import type { GeneratedListItem, GeneratedSection } from '@noted/shared-types';

/**
 * A section stored before blocks existed.
 *
 * Its `items` array becomes one bullet-list block, keeping every id, status,
 * origin and source range. Lossless on purpose: an artifact is rebuildable in
 * principle, but not for a capture whose audio and transcript have since been
 * deleted — for those this row IS the note, and dropping it would be deleting
 * somebody's note during an upgrade.
 */
export function toBlockSection(section: unknown): GeneratedSection {
  const raw = section as GeneratedSection & { items?: GeneratedListItem[] };
  if (Array.isArray(raw.blocks)) return raw;

  const items = Array.isArray(raw.items) ? raw.items : [];
  return {
    id: raw.id,
    kind: raw.kind,
    heading: raw.heading,
    blocks:
      items.length > 0
        ? [
            {
              id: `${raw.id}:legacy-list`,
              kind: 'bullet-list',
              status: 'active',
              origin: 'legacy',
              sources: [],
              items,
            },
          ]
        : [],
  };
}
