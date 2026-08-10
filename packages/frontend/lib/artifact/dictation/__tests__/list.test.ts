import { describe, expect, it } from 'vitest';

import { visibleItems } from '@/lib/artifact/artifact';
import { parseListCommands } from '@/lib/artifact/dictation/instructions';
import { buildDictatedList, checklistKindFor } from '@/lib/artifact/dictation/list';
import type { GeneratedChecklistItem, SourceRange } from '@noted/shared-types';

const CAPTURE_ID = 'c1';

function sourceAt(atMs: number): SourceRange[] {
  return [{ captureId: CAPTURE_ID, startMs: atMs, endMs: atMs + 4_000, segmentIds: [`c1#0.${String(atMs)}`] }];
}

function dictate(...lines: string[]): ReturnType<typeof buildDictatedList> {
  return buildDictatedList({
    commands: parseListCommands(lines.map((text, index) => ({ text, startMs: index * 5_000 }))),
    captureId: CAPTURE_ID,
    sourceAt,
  });
}

function texts(items: readonly GeneratedChecklistItem[]): string[] {
  return visibleItems(items).map((item) => item.text);
}

describe('checklistKindFor', () => {
  it('gives each intent its own list', () => {
    expect(checklistKindFor('shopping-list')).toBe('shopping');
    expect(checklistKindFor('task-list')).toBe('actions');
    expect(checklistKindFor('packing-list')).toBe('packing');
    expect(checklistKindFor('steps')).toBe('steps');
    expect(checklistKindFor('freeform')).toBe('custom');
  });
});

describe('an explicit list', () => {
  // The issue's first example, verbatim: three items, and no creative expansion.
  const built = dictate('Haz una lista de la compra: pollo, salchichas y pasta.');

  it('is a checklist, not prose about somebody reading a list aloud', () => {
    expect(built.intent).toBe('shopping-list');
    expect(built.checklist?.kind).toBe('shopping');
  });

  it('has exactly what was said and nothing else', () => {
    expect(texts(built.checklist?.items ?? [])).toEqual(['pollo', 'salchichas', 'pasta']);
  });

  it('marks the items as something the user asked for, with their evidence', () => {
    for (const item of built.checklist?.items ?? []) {
      expect(item.origin).toBe('explicit-instruction');
      expect(item.sources[0].segmentIds).toHaveLength(1);
      expect(item.checked).toBe(false);
    }
  });

  it('adds nothing at all without an instruction to', () => {
    expect(built.pendingExpansions).toEqual([]);
  });
});

describe('corrections', () => {
  it('removes the item somebody took back', () => {
    const built = dictate(
      'Quiero una lista de la compra. Añade pollo, salchichas y pasta.',
      'Quita las salchichas.',
    );
    expect(texts(built.checklist?.items ?? [])).toEqual(['pollo', 'pasta']);
  });

  it('keeps the removal as history rather than deleting the item', () => {
    // The user watched the correction happen, and an id they may already have
    // touched has to keep pointing at something.
    const built = dictate('Añade pollo y salchichas.', 'Quita las salchichas.');
    const removed = built.checklist?.items.find((item) => item.text === 'salchichas');
    expect(removed?.status).toBe('removed');
  });

  it('treats "I already have it" as a removal', () => {
    const built = dictate('Añade mozzarella y tomate.', 'Ya tengo mozzarella, no la añadas.');
    expect(texts(built.checklist?.items ?? [])).toEqual(['tomate']);
  });

  it('puts a quantity on the item it belongs to, not on a new line', () => {
    // The failure this exists to prevent: "pollo" and "dos kilos de pollo" as two
    // separate things to buy.
    const built = dictate('Añade pollo y pasta.', 'Pon dos kilos de pollo.');
    const chicken = built.checklist?.items.find((item) => item.text === 'pollo');
    expect(chicken?.quantity).toBe('dos kilos');
    expect(built.checklist?.items).toHaveLength(2);
  });

  it('replaces a quantity rather than stacking another one', () => {
    const built = dictate('Añade pollo.', 'Pon dos kilos de pollo.', 'Mejor pon tres kilos de pollo.');
    expect(built.checklist?.items[0].quantity).toBe('tres kilos');
    expect(built.checklist?.items).toHaveLength(1);
  });

  it('adds the item when a quantity arrives for something not on the list', () => {
    const built = dictate('Haz una lista de la compra.', 'Añade dos kilos de pollo.');
    expect(built.checklist?.items[0]).toMatchObject({ text: 'pollo', quantity: 'dos kilos' });
  });
});

describe('what something is for', () => {
  it('is kept beside the item rather than inside it', () => {
    // So the list can be grouped — "separa lo de la carbonara de lo de la pizza"
    // — and so the same ingredient asked for twice, for two dishes, is one line.
    const built = dictate('Añade pollo, salchichas y pasta para hacer una carbonara.');
    const pasta = built.checklist?.items.find((item) => item.text === 'pasta');
    expect(pasta?.category).toBe('una carbonara');
    expect(texts(built.checklist?.items ?? [])).toEqual(['pollo', 'salchichas', 'pasta']);
  });

  it('merges the same ingredient wanted for two things', () => {
    const built = dictate('Añade tomate para la pizza.', 'Y añade tomate.');
    expect(texts(built.checklist?.items ?? [])).toEqual(['tomate']);
    expect(built.checklist?.items[0].category).toBe('la pizza');
  });
});

describe('saying the same thing twice', () => {
  it('does not list it twice', () => {
    const built = dictate('Añade pollo y pasta.', 'Ah, y añade pollo.');
    expect(texts(built.checklist?.items ?? [])).toEqual(['pollo', 'pasta']);
  });

  it('keeps the more specific wording', () => {
    // "pasta" then "pasta integral" is a person being more specific, not a
    // second product.
    const built = dictate('Añade pasta.', 'Añade pasta integral.');
    expect(texts(built.checklist?.items ?? [])).toEqual(['pasta integral']);
  });
});

describe('authorised expansion', () => {
  const built = dictate(
    'Quiero una lista de la compra. Añade pollo, salchichas y pasta para hacer una carbonara.',
    'También pon todos los ingredientes necesarios para hacer una pizza de pollo.',
  );

  it('records the permission and what it covers', () => {
    expect(built.pendingExpansions).toHaveLength(1);
    expect(built.pendingExpansions[0].subject).toBe('una pizza de pollo');
  });

  it('keeps the sentence that granted it, so a derived item can cite it', () => {
    expect(built.pendingExpansions[0].instructionSource.segmentIds).toHaveLength(1);
  });

  it('invents nothing itself', () => {
    // The deterministic pass has no knowledge to contribute, and a recipe it
    // made up would be exactly the failure the origin field exists to prevent.
    // Pending is the honest state, not "done".
    expect(texts(built.checklist?.items ?? [])).toEqual(['pollo', 'salchichas', 'pasta']);
    expect(
      (built.checklist?.items ?? []).every((item) => item.origin === 'explicit-instruction'),
    ).toBe(true);
  });
});

describe('nothing dictated', () => {
  it('produces no list at all', () => {
    const built = dictate('Empezamos la revisión del presupuesto.', 'Hay que enviar el contrato.');
    expect(built.checklist).toBeNull();
    expect(built.intent).toBe('freeform');
  });
});
