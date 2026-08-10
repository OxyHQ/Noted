import { describe, expect, it } from 'vitest';

import { parseCommand, parseListCommands, splitItems } from '@/lib/artifact/dictation/instructions';

function blocks(...lines: string[]): { text: string; startMs: number }[] {
  return lines.map((text, index) => ({ text, startMs: index * 5_000 }));
}

describe('splitItems', () => {
  it('splits the way people say a list', () => {
    expect(splitItems('pollo, salchichas y pasta')).toEqual(['pollo', 'salchichas', 'pasta']);
  });

  it('drops the article people put in front of things', () => {
    expect(splitItems('el pollo, las salchichas')).toEqual(['pollo', 'salchichas']);
  });

  it('ignores the noise at the end of a sentence', () => {
    expect(splitItems('pollo y pasta.')).toEqual(['pollo', 'pasta']);
  });
});

describe('recognising an instruction', () => {
  it('reads a list somebody asked for', () => {
    const command = parseCommand('Haz una lista de la compra: pollo, salchichas y pasta.', 0);
    expect(command).toMatchObject({
      kind: 'create',
      intent: 'shopping-list',
      items: ['pollo', 'salchichas', 'pasta'],
    });
  });

  it('knows which kind of list', () => {
    expect(parseCommand('Quiero una lista de tareas.', 0)).toMatchObject({ intent: 'task-list' });
    expect(parseCommand('Hazme una lista del equipaje.', 0)).toMatchObject({
      intent: 'packing-list',
    });
    expect(parseCommand('Haz una lista.', 0)).toMatchObject({ intent: 'checklist' });
  });

  it('reads an addition', () => {
    expect(parseCommand('Añade pollo y pasta.', 0)).toMatchObject({
      kind: 'add',
      items: ['pollo', 'pasta'],
    });
  });

  it('reads a removal', () => {
    expect(parseCommand('Quita las salchichas.', 0)).toMatchObject({
      kind: 'remove',
      item: 'salchichas',
    });
  });

  it('reads "I already have it" as a removal, because that is what it means', () => {
    // The phrasing people actually use while shopping: the item is not wrong, it
    // is simply not needed.
    expect(parseCommand('Ya tengo mozzarella, no la añadas.', 0)).toMatchObject({
      kind: 'remove',
      item: 'mozzarella',
    });
  });

  it('reads a quantity as a correction to an item, not as a new one', () => {
    // Otherwise "pon dos kilos de pollo" adds a second, differently-worded
    // chicken underneath the first.
    expect(parseCommand('Pon dos kilos de pollo.', 0)).toMatchObject({
      kind: 'quantity',
      item: 'pollo',
      quantity: 'dos kilos',
    });
    expect(parseCommand('Añade 2 kg de pasta.', 0)).toMatchObject({
      kind: 'quantity',
      item: 'pasta',
      quantity: '2 kg',
    });
  });

  it('reads an authorised expansion, and keeps what was authorised', () => {
    expect(
      parseCommand('También pon todos los ingredientes necesarios para hacer una pizza de pollo.', 0),
    ).toMatchObject({ kind: 'expand', subject: 'una pizza de pollo' });
  });

  it('reads the expansion before the addition it is also shaped like', () => {
    // "Añade todos los ingredientes para una pizza" matches the ordinary add
    // pattern too, and reading it as one files "todos los ingredientes para una
    // pizza" as a shopping item.
    expect(parseCommand('Añade todos los ingredientes para una pizza.', 0)?.kind).toBe('expand');
  });

  it('finds the item whichever clause carries it', () => {
    expect(parseCommand('No la añadas, ya tengo mozzarella.', 0)).toMatchObject({
      kind: 'remove',
      item: 'mozzarella',
    });
  });

  it('refuses to guess what a bare pronoun meant', () => {
    // Resolving "no la añadas" would mean picking an item, and picking wrong
    // deletes a line off somebody's shopping list. Doing nothing costs them one
    // retyped word.
    expect(parseCommand('No la añadas.', 0)).toBeNull();
  });
});

describe('what is NOT an instruction', () => {
  it('ignores somebody talking about a list', () => {
    // The whole trust rule: discussion may be reported, never acted on.
    expect(parseCommand('Estuvimos mirando la lista de precios del proveedor.', 0)).toBeNull();
  });

  it('ignores talking about making a pizza', () => {
    // "Hablamos de hacer una pizza" does not authorise adding flour.
    expect(parseCommand('Hablamos de hacer una pizza para el sábado.', 0)).toBeNull();
  });

  it('ignores an ordinary sentence', () => {
    expect(parseCommand('El presupuesto sube un diez por ciento.', 0)).toBeNull();
  });
});

describe('parseListCommands', () => {
  it('reads every instruction in a recording, in order', () => {
    const commands = parseListCommands(
      blocks(
        'Quiero una lista de la compra. Añade pollo, salchichas y pasta.',
        'Quita las salchichas.',
        'Pon dos kilos de pollo.',
      ),
    );
    expect(commands.map((command) => command.kind)).toEqual([
      'create',
      'add',
      'remove',
      'quantity',
    ]);
    expect(commands[2].atMs).toBe(5_000);
  });

  it('finds nothing in an ordinary meeting', () => {
    expect(
      parseListCommands(
        blocks('Empezamos la revisión del presupuesto.', 'Hay que enviar el contrato el viernes.'),
      ),
    ).toEqual([]);
  });
});
