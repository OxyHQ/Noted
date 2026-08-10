/**
 * That the app stops blaming the device for things the device did not do.
 *
 * #68 in one line: `enhanceNote()` returned a boolean, and `false` covered a
 * missing GPU, a reply that was never JSON, a reply cut off by a token ceiling,
 * a document whose every paragraph was dropped by a limit written for bullets,
 * and a commit that lost a race. The coordinator turned all of them into
 * `enhancement: 'unsupported'`, which the user reads as:
 *
 *     Basic notes are ready. This device cannot organize them further.
 *
 * Five of those are not about the device and three of them are retryable. A
 * user was told to accept transcript fragments on a machine that could have
 * produced the document, and was offered no way to ask again.
 *
 * These pin the distinctions. Each case asserts the STATE the app lands in,
 * because that is what decides the sentence on screen and whether a retry
 * button exists.
 */

import { describe, expect, it } from 'vitest';

import { lifecycleFor } from '@/lib/capture/coordinator';
import { isRetryable, type EnhancementOutcome } from '@/lib/capture/enhancement-outcome';
import { parseEnhancement } from '@/lib/enhance/parse';
import { FIELDS } from '@/lib/enhance/schema';

const SHOWN = { lineCount: 3, authorisedSubjects: [] };

describe('only one outcome may claim the device cannot do it', () => {
  it.each([
    ['insecure_context'],
    ['navigator_gpu_missing'],
    ['adapter_unavailable'],
    ['device_request_failed'],
    ['runtime_initialization_failed'],
    ['model_files_unavailable'],
  ] as const)('unavailable/%s is unsupported, and says which', (reason) => {
    const state = lifecycleFor({
      kind: 'unavailable',
      capability: { kind: 'unavailable', reason },
    });
    expect(state.enhancement).toBe('unsupported');
    // The reason survives, because "not a secure context" and "no adapter" need
    // different sentences and only one of them is about hardware.
    expect(state.enhancementReason).toBe(reason);
  });

  it.each([
    [{ kind: 'invalid-output', reason: 'truncated' }, 'failed'],
    [{ kind: 'invalid-output', reason: 'malformed_json' }, 'failed'],
    [{ kind: 'invalid-output', reason: 'all_content_dropped' }, 'failed'],
    [{ kind: 'no-change', reason: 'equivalent' }, 'complete'],
    [{ kind: 'no-change', reason: 'nothing_useful' }, 'complete'],
    [{ kind: 'stale', currentRevision: 4 }, 'complete'],
    [{ kind: 'improved', artifactRevision: 2 }, 'complete'],
  ] as [EnhancementOutcome, string][])('%o is never unsupported', (outcome, expected) => {
    expect(lifecycleFor(outcome).enhancement).toBe(expected);
  });
});

describe('a reply that was cut off is told apart from one that was refused', () => {
  it('names truncation with its own error code', () => {
    // The one failure that names its own remedy: the model was working and ran
    // out of room. Asking again with more room is a real fix; buying a new
    // laptop is not.
    expect(lifecycleFor({ kind: 'invalid-output', reason: 'truncated' }).errorCode).toBe(
      'model_output_truncated',
    );
    expect(lifecycleFor({ kind: 'invalid-output', reason: 'no_json_object' }).errorCode).toBe(
      'model_output_invalid',
    );
  });

  it('offers a retry for an unusable answer and not for a missing GPU', () => {
    expect(isRetryable({ kind: 'invalid-output', reason: 'truncated' })).toBe(true);
    expect(
      isRetryable({
        kind: 'unavailable',
        capability: { kind: 'unavailable', reason: 'adapter_unavailable' },
      }),
    ).toBe(false);
    expect(isRetryable({ kind: 'improved', artifactRevision: 1 })).toBe(false);
  });
});

describe('the parser says why, not just no', () => {
  it('calls an object that never closed truncated', () => {
    // The exact shape a token ceiling produces: the model was answering
    // correctly and generation stopped. `null` used to make this identical to a
    // model that replied in prose.
    const cut = `{"${FIELDS.title}": "Una charla", "${FIELDS.sections}": [{"${FIELDS.blocks}": [{"${FIELDS.type}": "paragraph", "${FIELDS.text}": "Empezó explicando`;
    const result = parseEnhancement(cut, SHOWN);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('truncated');
    expect(result.diagnostics.jsonObjectStarted).toBe(true);
    expect(result.diagnostics.bracesBalanced).toBe(false);
  });

  it('calls prose with no JSON in it something else entirely', () => {
    const result = parseEnhancement('Lo siento, no puedo ayudar con eso.', SHOWN);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('no_json_object');
    expect(result.diagnostics.jsonObjectStarted).toBe(false);
  });

  it('tells malformed JSON from no JSON', () => {
    const result = parseEnhancement('{"a": "b",,}', SHOWN);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('malformed_json');
    expect(result.diagnostics.bracesBalanced).toBe(true);
    expect(result.diagnostics.jsonParsed).toBe(false);
  });

  it('calls a title with nothing under it nothing useful, not a hardware limit', () => {
    const result = parseEnhancement(JSON.stringify({ [FIELDS.title]: 'Una charla' }), SHOWN);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('nothing_useful');
  });

  it('reports content it received and threw away, with counts', () => {
    // The failure that produced the reported page: a document arrived, every
    // block was refused, and the user was told their device was incapable.
    const unknownBlocks = JSON.stringify({
      [FIELDS.title]: 'Una charla',
      [FIELDS.sections]: [
        {
          [FIELDS.heading]: 'Un tema',
          [FIELDS.blocks]: [
            { [FIELDS.type]: 'diagram', [FIELDS.text]: 'algo' },
            { [FIELDS.type]: 'table', [FIELDS.text]: 'algo más' },
          ],
        },
      ],
    });
    const result = parseEnhancement(unknownBlocks, SHOWN);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('all_content_dropped');
    expect(result.diagnostics.blocksDropped).toBe(2);
    expect(result.diagnostics.sectionsDropped).toBe(1);
  });

  it('counts citations to lines the model was never shown', () => {
    const cited = JSON.stringify({
      [FIELDS.title]: 'Una charla',
      [FIELDS.sections]: [
        {
          [FIELDS.blocks]: [
            { [FIELDS.type]: 'paragraph', [FIELDS.text]: 'Prosa.', [FIELDS.sources]: [1, 99, 100] },
          ],
        },
      ],
    });
    const result = parseEnhancement(cited, SHOWN);
    expect(result.ok).toBe(true);
    expect(result.diagnostics.invalidSourceRefs).toBe(2);
  });
});

describe('a paragraph is not a long bullet', () => {
  /** Longer than the old shared 400, which is what silently deleted it. */
  const LONG = `El ministerio consultó a neurocientíficos y a científicos cognitivos. ${'La conclusión fue que la tecnología no es el problema, sino la capacidad humana de aprender. '.repeat(6)}`.trim();

  const withParagraph = (text: string) =>
    JSON.stringify({
      [FIELDS.title]: 'Una charla',
      [FIELDS.sections]: [
        {
          [FIELDS.heading]: 'Consultas',
          [FIELDS.blocks]: [{ [FIELDS.type]: 'paragraph', [FIELDS.text]: text, [FIELDS.sources]: [1] }],
        },
      ],
    });

  it('survives being longer than 400 characters', () => {
    // The regression #68 asks for by name. `MAX_ITEM_CHARS = 400` was written
    // for bullets and then applied to every unit, so a coherent paragraph was
    // replaced with the empty string, the block was dropped, the document
    // became empty, and the UI blamed the device.
    expect(LONG.length).toBeGreaterThan(400);
    const result = parseEnhancement(withParagraph(LONG), SHOWN);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.sections[0].blocks[0]).toMatchObject({ type: 'paragraph', text: LONG });
    expect(result.diagnostics.oversizeDropped).toBe(0);
  });

  it('still refuses a paragraph that is a whole transcript', () => {
    // The limit did not go away, it went up to what a paragraph is. Something
    // that long is the model pasting the recording back.
    const enormous = 'palabra '.repeat(1_000);
    const result = parseEnhancement(withParagraph(enormous), SHOWN);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.diagnostics.oversizeDropped).toBeGreaterThan(0);
  });

  it('keeps the bullet limit where it belongs', () => {
    // A list item over 400 characters is prose wearing a bullet, and that IS
    // the case the number was chosen for.
    const bulleted = JSON.stringify({
      [FIELDS.title]: 'Una charla',
      [FIELDS.sections]: [
        {
          [FIELDS.blocks]: [
            {
              [FIELDS.type]: 'bullet-list',
              [FIELDS.items]: [{ [FIELDS.text]: LONG, [FIELDS.sources]: [1] }],
            },
          ],
        },
      ],
    });
    const result = parseEnhancement(bulleted, SHOWN);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.diagnostics.oversizeDropped).toBeGreaterThan(0);
  });

  it('keeps the valid sections when one block among them is refused', () => {
    const mixed = JSON.stringify({
      [FIELDS.title]: 'Una charla',
      [FIELDS.sections]: [
        {
          [FIELDS.heading]: 'Consultas',
          [FIELDS.blocks]: [
            { [FIELDS.type]: 'paragraph', [FIELDS.text]: LONG, [FIELDS.sources]: [1] },
            { [FIELDS.type]: 'diagram', [FIELDS.text]: 'no' },
          ],
        },
      ],
    });
    const result = parseEnhancement(mixed, SHOWN);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.sections[0].blocks).toHaveLength(1);
    expect(result.diagnostics.blocksAccepted).toBe(1);
    expect(result.diagnostics.blocksDropped).toBe(1);
  });
});
