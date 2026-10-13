import { describe, expect, it } from 'vitest';
import en from '@/lib/i18n/locales/en.json';
import { TEMPLATE_IDS, applyTemplate, renderTemplate } from '@/lib/notes/templates';

const t = (key: string): string =>
  key
    .split('.')
    .reduce<unknown>((value, part) => (value as Record<string, unknown>)?.[part], en) as string;

describe('templates', () => {
  it('has a name, title and body in the catalogue for every template', () => {
    for (const id of TEMPLATE_IDS) {
      for (const field of ['name', 'title', 'body']) {
        expect(t(`templates.${id}.${field}`), `${id}.${field}`).toBeTruthy();
      }
    }
  });

  it('fills the date everywhere it appears', () => {
    const rendered = renderTemplate(
      'meeting',
      (k) => (k.endsWith('title') ? 'A {{date}}' : 'b {{date}} c {{date}}'),
      '13 Oct',
    );
    expect(rendered).toEqual({ title: 'A 13 Oct', body: 'b 13 Oct c 13 Oct' });
  });

  it('never leaves a placeholder behind', () => {
    for (const id of TEMPLATE_IDS) {
      const { title, body } = renderTemplate(id, t, 'today');
      expect(`${title}${body}`).not.toContain('{{');
    }
  });

  it('keeps what the user already typed', () => {
    const template = { title: 'T', body: '## Body' };
    expect(applyTemplate({ title: '', body: '' }, template)).toEqual(template);
    expect(applyTemplate({ title: 'Mine', body: 'draft\n' }, template)).toEqual({
      title: 'Mine',
      body: 'draft\n\n## Body',
    });
  });
});
