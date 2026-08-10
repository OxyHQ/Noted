/**
 * The note generator, measured across a corpus instead of one recording at a time.
 *
 * Every other test in this repo asks whether one behaviour is right. This asks
 * whether the notes are GOOD, across eight recordings of different shapes, using
 * numbers that can go down — which is the only way "we improved the generator"
 * is ever checkable.
 *
 * ## Read the floors as floors
 *
 * These assert the deterministic pass: the note a user gets with no model
 * installed, or when one fails. It is extractive, so it will never score
 * perfectly on retention and is not supposed to. What it must never do is invent
 * — so the precision floors are strict and the retention floor is not.
 *
 * A failure here names the scenario and what it lost or made up, because a
 * corpus that only reports a ratio tells you the number moved and not why.
 */

import { describe, expect, it } from 'vitest';

import { buildDeterministicArtifact } from '@/lib/artifact/generate/deterministic';
import { finalizeArtifact } from '@/lib/artifact/finalize';
import { reduceLiveArtifact } from '@/lib/artifact/reduce';
import { visibleItems } from '@/lib/artifact/artifact';
import { CORPUS, segmentsOf, type EvalScenario } from '@/lib/eval/corpus';
import {
  actionTexts,
  duplicates,
  precision,
  retention,
  stability,
  unauthorisedDerivations,
  unsupportedClaims,
} from '@/lib/eval/metrics';

const startedAt = new Date('2026-08-09T09:00:00.000Z');

function build(
  scenario: EvalScenario,
  upTo = scenario.slices.length,
  stage: 'live' | 'final' = upTo === scenario.slices.length ? 'final' : 'live',
) {
  return buildDeterministicArtifact({
    noteId: `note_${scenario.id}`,
    captureId: scenario.captureId,
    segments: segmentsOf(scenario).slice(0, upTo),
    startedAt,
    stage,
    profile: scenario.profile,
    transcriptRevision: upTo,
    now: '2026-08-09T09:10:00.000Z',
  });
}

describe('the corpus itself', () => {
  it('covers more than one shape of recording', () => {
    // A floor on the corpus, not on the generator. A traversal that silently
    // returned nothing would pass every assertion below.
    expect(CORPUS.length).toBeGreaterThanOrEqual(8);
    expect(new Set(CORPUS.map((scenario) => scenario.profile)).size).toBeGreaterThan(2);
  });

  it('gives every scenario a stated expectation', () => {
    for (const scenario of CORPUS) {
      expect(scenario.mustKeep.length, scenario.id).toBeGreaterThan(0);
      expect(scenario.slices.length, scenario.id).toBeGreaterThan(0);
    }
  });
});

describe('nothing enters a note unsupported', () => {
  it.each(CORPUS.map((scenario) => [scenario.id, scenario] as const))(
    '%s',
    (_id, scenario) => {
      // The strictest line in this file, and the one worth keeping strict: an
      // item claiming to come from the recording with no source range is a claim
      // the reader cannot check and neither can anything else.
      const artifact = build(scenario);
      expect(unsupportedClaims(artifact), scenario.what).toEqual([]);
      expect(unauthorisedDerivations(artifact), scenario.what).toEqual([]);
    },
  );
});

describe('no task the recording did not assign', () => {
  it.each(CORPUS.map((scenario) => [scenario.id, scenario] as const))(
    '%s',
    (_id, scenario) => {
      const found = actionTexts(build(scenario));
      const score = precision(found, scenario.actions);
      expect(score.spurious, `${scenario.what} — invented: ${score.spurious.join(' | ')}`).toEqual(
        [],
      );
    },
  );
});

describe('no question the recording already answered', () => {
  it.each(CORPUS.map((scenario) => [scenario.id, scenario] as const))(
    '%s',
    (_id, scenario) => {
      const open = visibleItems(build(scenario).openQuestions).map((item) => item.text);
      const score = precision(open, scenario.openQuestions);
      expect(score.spurious, `${scenario.what} — still open: ${score.spurious.join(' | ')}`).toEqual(
        [],
      );
    },
  );
});

describe('what mattered survived', () => {
  it.each(CORPUS.map((scenario) => [scenario.id, scenario] as const))(
    '%s',
    (_id, scenario) => {
      // Loose on purpose. An extractive pass selects sentences; it cannot be
      // asked to keep every fact and still be a summary. What it must not do is
      // lose all of them, which is what a broken selector looks like.
      const score = retention(build(scenario), scenario.mustKeep);
      expect(score.ratio, `${scenario.what} — lost: ${score.lost.join(' | ')}`).toBeGreaterThan(0);
    },
  );

  it('keeps most of it across the corpus', () => {
    const ratios = CORPUS.map((scenario) => retention(build(scenario), scenario.mustKeep).ratio);
    const mean = ratios.reduce((total, ratio) => total + ratio, 0) / ratios.length;
    expect(mean).toBeGreaterThan(0.6);
  });
});

describe('the same thing is not said twice', () => {
  it.each(CORPUS.map((scenario) => [scenario.id, scenario] as const))(
    '%s',
    (_id, scenario) => {
      // Two windows both covering the moment somebody stated a decision is the
      // ordinary way this happens, and a reader reads it as two decisions.
      const repeated = duplicates(build(scenario));
      expect(repeated, `${scenario.what} — repeated: ${repeated.join(' | ')}`).toEqual([]);
    },
  );
});

describe('a note does not start over every few seconds', () => {
  it.each(
    CORPUS.filter((scenario) => scenario.slices.length > 1).map(
      (scenario) => [scenario.id, scenario] as const,
    ),
  )('%s', (_id, scenario) => {
    // Through the REAL path: a live pass, then the finaliser reading it. Two
    // independent builds of the same transcript share no history by
    // construction, so measuring those would report churn the app never
    // produces — and read as a defect in the app rather than in the harness.
    const live = build(scenario, 1);
    const settled = finalizeArtifact({
      previous: reduceLiveArtifact(live, build(scenario, scenario.slices.length, 'live'), new Map()),
      next: build(scenario),
      overrides: new Map(),
      now: '2026-08-09T09:10:00.000Z',
    });

    // Anything the user could have ticked in the live note must still be
    // findable by its id, whether it is still active or has been resolved.
    const churn = stability(live, settled).churn;
    expect(churn, `${scenario.what} — churn ${String(Math.round(churn * 100))}%`).toBeLessThan(0.5);
  });
});
