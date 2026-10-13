/**
 * Starting points for a note.
 *
 * The text lives in the translation catalogues (`templates.<id>.*`), not here:
 * a template is prose in the reader's language. This file only knows which
 * templates exist and how a title and body are filled in.
 */

export const TEMPLATE_IDS = ['meeting', 'lecture', 'journal', 'weekly', 'project'] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

export interface RenderedTemplate {
  title: string;
  body: string;
}

type Translate = (key: string) => string;

/** `{{date}}` is the only placeholder, replaced everywhere it appears. */
function fill(text: string, date: string): string {
  return text.replaceAll('{{date}}', date);
}

/** The title and body of a template, in the caller's language, for `date`. */
export function renderTemplate(id: TemplateId, t: Translate, date: string): RenderedTemplate {
  return {
    title: fill(t(`templates.${id}.title`), date),
    body: fill(t(`templates.${id}.body`), date),
  };
}

/**
 * Put a template into a draft without destroying what is already there: an
 * empty title takes the template's, an empty body becomes the template, and a
 * body that already has text keeps it with the template added below.
 */
export function applyTemplate(
  draft: { title: string; body: string },
  template: RenderedTemplate,
): { title: string; body: string } {
  const body =
    draft.body.trim() === '' ? template.body : `${draft.body.trimEnd()}\n\n${template.body}`;
  return { title: draft.title.trim() === '' ? template.title : draft.title, body };
}
