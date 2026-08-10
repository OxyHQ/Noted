/**
 * The recording reported in #59, end to end.
 *
 * A single-speaker talk with no tasks, no decisions and no dialogue — a person
 * explaining a line of reasoning in the first person. It came back as a bullet
 * list of their own sentences, so the note read as though the speaker had
 * written it, and the page said the notes could not be finished at all.
 *
 * ## What is and is not verified here, stated plainly
 *
 * The MODEL is not run. It cannot be: it is 483 MB of weights and a GPU, and a
 * suite built on a mock of it would only be testing the mock. What runs here is
 * everything around it — classification, the prompt it would be given, the parse
 * of a reply, and the document that reply becomes — with a fake generator
 * returning the kind of answer the schema asks for.
 *
 * So these assertions prove the pipeline can express and carry a proper document,
 * and that the deterministic floor is honest about being a floor. Whether the
 * 0.5B model actually writes prose of this quality is a question only a real
 * device answers, and it is not claimed here.
 */

import { describe, expect, it, vi } from 'vitest';

import { allItems, visibleItems } from '@/lib/artifact/artifact';
import { buildDeterministicArtifact, cleanedBlocks } from '@/lib/artifact/generate/deterministic';
import { enhancementToArtifact } from '@/lib/artifact/generate/from-enhancement';
import { classifyProfile, resolveProfile, spokenProfile } from '@/lib/artifact/profile';
import { renderArtifact } from '@/lib/artifact/render';
import { parseListCommands } from '@/lib/artifact/dictation/instructions';
import { summarize } from '@/lib/enhance/summarize';
import { FIELDS } from '@/lib/enhance/schema';
import type { EnhanceRequest } from '@/lib/enhance/contract';
import {
  TALK_CAPTURE_ID,
  TALK_SEGMENTS,
  TALK_SLICES,
} from '@/lib/artifact/__fixtures__/talk-transcript';

const startedAt = new Date('2026-08-09T18:00:00.000Z');
const BLOCKS = cleanedBlocks(TALK_SEGMENTS);

describe('the transcript stays evidence', () => {
  it('keeps what was said, first person and all', () => {
    // The transcript is not the note. It is the record the note is checked
    // against, and a record rewritten into third person cannot check anything.
    expect(TALK_SEGMENTS[0].text.startsWith("I'm going to talk about humans")).toBe(true);
    expect(TALK_SEGMENTS.some((segment) => / I became a minister /.test(segment.text))).toBe(true);
  });

  it('keeps its timestamps', () => {
    expect(TALK_SLICES.map((slice) => slice.atMs)).toEqual([0, 60_000, 118_000, 178_000]);
  });

  it("keeps the recogniser's own mistakes", () => {
    // "Judge ETP" is ChatGPT and "OSCD" is the OECD. Cleaning them here would be
    // testing a recording nobody made — and the note has to survive them.
    expect(TALK_SEGMENTS[0].text).toContain('Judge ETP');
    expect(TALK_SEGMENTS[1].text).toContain('OSCD');
  });
});

describe('what kind of recording this is', () => {
  it('is read as a talk, from its shape rather than from a phrase', () => {
    // It opens "I'm going to talk about humans". No list of marker phrases was
    // ever going to catch that; what does is that one voice holds the floor for
    // minutes and answers its own questions.
    expect(classifyProfile(BLOCKS, parseListCommands(BLOCKS))).toBe('event');
  });

  it('is no longer mistaken for a meeting because somebody said "agenda"', () => {
    // The bug this fixture caught: the speaker says "AI was not on the agenda",
    // which is a topic, and the classifier read it as a description of the
    // recording.
    expect(classifyProfile(BLOCKS, parseListCommands(BLOCKS))).not.toBe('meeting');
  });

  it('still lets the user overrule it', () => {
    expect(
      resolveProfile({
        selected: 'lecture',
        spoken: spokenProfile(BLOCKS),
        classified: classifyProfile(BLOCKS, parseListCommands(BLOCKS)),
      }),
    ).toBe('lecture');
  });
});

describe('the deterministic floor is honest about being a floor', () => {
  const artifact = buildDeterministicArtifact({
    noteId: 'note_talk',
    captureId: TALK_CAPTURE_ID,
    segments: TALK_SEGMENTS,
    startedAt,
    stage: 'final',
    transcriptRevision: 4,
    now: '2026-08-09T18:05:00.000Z',
  });

  it('says what it produced, rather than calling extraction a finished note', () => {
    // It selects sentences somebody said. It cannot rewrite first person into
    // prose about a speaker, and a heading that admits this is the difference
    // between a floor and a lie.
    expect(renderArtifact(artifact)).toContain('## Transcript highlights');
  });

  it('invents no tasks from a talk that assigned none', () => {
    expect(artifact.checklists).toEqual([]);
  });

  it("files none of the speaker's rhetorical questions as open", () => {
    // "Should we actually give up learning altogether?" is answered in the next
    // breath. The original bug was a note consisting of nothing else.
    expect(visibleItems(artifact.openQuestions)).toEqual([]);
  });

  it('grounds every line it wrote in the recording', () => {
    for (const unit of allItems(artifact)) {
      if (unit.origin !== 'transcript') continue;
      expect(unit.sources.length, unit.text).toBeGreaterThan(0);
    }
  });
});

/**
 * A reply of the shape the schema asks for.
 *
 * Written by hand, not by a model: what is under test is that a document like
 * this SURVIVES the pipeline, keeps its structure, and lands in the note. The
 * text is close to the example in #59 so the assertions below mean what they say.
 */
function modelReply(): string {
  return JSON.stringify({
    [FIELDS.profile]: 'event',
    [FIELDS.title]: 'Humans, AI and the future of education',
    [FIELDS.people]: [{ role: 'Education minister', [FIELDS.sources]: [1] }],
    [FIELDS.sections]: [
      {
        [FIELDS.heading]: "How AI entered the ministry's agenda",
        [FIELDS.blocks]: [
          {
            [FIELDS.type]: 'paragraph',
            [FIELDS.text]:
              "The speaker explained that AI was not part of the ministry's agenda when they took office in April 2023. After advisers pointed out that students were already using it, the ministry consulted neuroscientists, cognitive scientists and technology companies.",
            [FIELDS.sources]: [1],
          },
        ],
      },
      {
        [FIELDS.heading]: 'The existing skills gap',
        [FIELDS.blocks]: [
          {
            [FIELDS.type]: 'paragraph',
            [FIELDS.text]:
              'A 2017 workforce survey reported that two thirds of workers already had literacy, numeracy and digital skills below the computers of the time.',
            [FIELDS.sources]: [3],
          },
          {
            [FIELDS.type]: 'bullet-list',
            [FIELDS.items]: [
              { [FIELDS.text]: 'literacy', [FIELDS.sources]: [3] },
              { [FIELDS.text]: 'numeracy', [FIELDS.sources]: [3] },
            ],
          },
        ],
      },
      {
        [FIELDS.heading]: 'The printing-press analogy',
        [FIELDS.blocks]: [
          {
            [FIELDS.type]: 'paragraph',
            [FIELDS.text]:
              'The speaker compared the moment with the invention of the printing press, which created pressure for widespread literacy. AI creates a comparable cognitive pressure.',
            [FIELDS.sources]: [4],
          },
        ],
      },
    ],
    [FIELDS.actions]: [],
    [FIELDS.openQuestions]: [],
    [FIELDS.listAdditions]: [],
  });
}

describe('the document the model is asked for, once it comes back', () => {
  const request: EnhanceRequest = {
    transcript: BLOCKS.map((block) => ({
      atMs: block.startMs,
      text: block.text,
      segmentIds: block.segmentIds,
    })),
    language: 'en',
    profile: 'event',
    intent: 'freeform',
    expansions: [],
  };

  async function build() {
    const result = await summarize(request, vi.fn().mockResolvedValue(modelReply()));
    expect(result.ok, result.ok ? '' : `refused: ${result.reason}`).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    const enhancement = result.value;
    return enhancementToArtifact({
      enhancement,
      captureId: TALK_CAPTURE_ID,
      noteId: 'note_talk',
      stage: 'final',
      profile: 'auto',
      intent: 'freeform',
      expansions: [],
      transcriptRevision: 4,
      now: '2026-08-09T18:05:00.000Z',
      fallbackTitle: startedAt.toLocaleString(),
    });
  }

  it('is titled for what it is about, not for how it opened', () => {
    return build().then((artifact) => {
      expect(artifact.title?.text).toBe('Humans, AI and the future of education');
      expect(artifact.title?.text.startsWith("I'm going to")).toBe(false);
    });
  });

  it('is organised into several subjects', () => {
    return build().then((artifact) => {
      expect(artifact.sections.length).toBeGreaterThan(1);
      expect(artifact.sections.every((section) => section.heading)).toBe(true);
    });
  });

  it('is not one long list', () => {
    return build().then((artifact) => {
      const blocks = artifact.sections.flatMap((section) => section.blocks);
      expect(blocks.some((block) => block.kind === 'paragraph')).toBe(true);
      expect(blocks.every((block) => block.kind === 'bullet-list')).toBe(false);
    });
  });

  it('is written about the speaker rather than as them', () => {
    return build().then((artifact) => {
      const prose = artifact.sections
        .flatMap((section) => section.blocks)
        .filter((block) => block.kind === 'paragraph');
      for (const block of prose) {
        expect(/^(I|We|My|Our)\b/.test(block.text), block.text).toBe(false);
      }
    });
  });

  it('records the role the recording stated and invents no name', () => {
    return build().then((artifact) => {
      expect(artifact.people?.[0].role).toBe('Education minister');
      expect(artifact.people?.[0].name).toBeUndefined();
    });
  });

  it('keeps the reasoning the talk was made of', () => {
    return build().then((artifact) => {
      const note = renderArtifact(artifact);
      for (const idea of ['April 2023', 'neuroscientists', '2017', 'printing press']) {
        expect(note, `lost: ${idea}`).toContain(idea);
      }
    });
  });

  it('has no actions and no open questions, because the talk had neither', () => {
    return build().then((artifact) => {
      expect(artifact.checklists).toEqual([]);
      expect(artifact.openQuestions).toEqual([]);
    });
  });

  it('can point every block at the recording', () => {
    return build().then((artifact) => {
      const blocks = artifact.sections.flatMap((section) => section.blocks);
      for (const block of blocks) {
        // The list block itself cites nothing; its lines do.
        if (block.kind === 'bullet-list' || block.kind === 'numbered-list') {
          expect(block.items.every((item) => item.sources.length > 0)).toBe(true);
          continue;
        }
        expect(block.sources.length, block.text).toBeGreaterThan(0);
        expect(block.sources[0].segmentIds.length).toBeGreaterThan(0);
      }
    });
  });

  it("takes the model's reading of what this is, since the user did not say", () => {
    return build().then((artifact) => {
      expect(artifact.profile).toBe('event');
    });
  });
});
