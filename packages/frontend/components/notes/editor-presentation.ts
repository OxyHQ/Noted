/**
 * How the block editor looks and speaks in Noted: its theme from the active
 * Bloom theme, its labels and `/` menu from the catalogue (`blockEditor.*`,
 * Nilo's own wording, so a note reads the same in both apps).
 */
import {
  blockColors,
  type EditorLabels,
  type EditorTheme,
  type SlashItem,
} from '@oxy.so/bloom-editor';
import { resolveAccentColors, useTheme } from '@oxy.so/bloom/theme';
import { useMemo } from 'react';

import { useTranslation } from '@/hooks/useTranslation';
import { useColorScheme } from '@/lib/useColorScheme';

export function useEditorTheme(): EditorTheme {
  const theme = useTheme();
  const { colors, isDarkColorScheme } = useColorScheme();
  return useMemo(
    () => ({
      text: colors.foreground,
      textMuted: colors.mutedForeground,
      // The note's tint shows through: the editor draws on nothing of its own.
      background: 'transparent',
      border: colors.border,
      accent: colors.primary,
      accentText: colors.primaryForeground,
      selection: resolveAccentColors(theme.colors, 'primary', 'subtle').background,
      codeBackground: colors.muted,
      colors: blockColors(isDarkColorScheme ? 'dark' : 'light'),
    }),
    [colors, isDarkColorScheme, theme.colors],
  );
}

export function useEditorLabels(): Partial<EditorLabels> {
  const { t } = useTranslation();
  return useMemo(
    () => ({
      placeholder: t('blockEditor.ui.placeholder'),
      emptyHeading: t('blockEditor.ui.emptyHeading'),
      emptyListItem: t('blockEditor.ui.emptyListItem'),
      emptyToggle: t('blockEditor.ui.emptyToggle'),
      slashNoResults: t('blockEditor.ui.slashNoResults'),
      mentionNoResults: t('blockEditor.ui.mentionNoResults'),
      mentionSearching: t('blockEditor.ui.mentionSearching'),
      slashGroups: {
        basic: t('blockEditor.slashGroups.basic'),
        advanced: t('blockEditor.slashGroups.advanced'),
      },
      turnInto: t('blockEditor.ui.turnInto'),
      duplicate: t('blockEditor.ui.duplicate'),
      delete: t('blockEditor.ui.delete'),
      moveUp: t('blockEditor.ui.moveUp'),
      moveDown: t('blockEditor.ui.moveDown'),
      indent: t('blockEditor.ui.indent'),
      outdent: t('blockEditor.ui.outdent'),
      color: t('blockEditor.ui.color'),
      background: t('blockEditor.ui.background'),
      colorNames: {
        default: t('blockEditor.colors.default'),
        gray: t('blockEditor.colors.gray'),
        brown: t('blockEditor.colors.brown'),
        orange: t('blockEditor.colors.orange'),
        yellow: t('blockEditor.colors.yellow'),
        green: t('blockEditor.colors.green'),
        blue: t('blockEditor.colors.blue'),
        purple: t('blockEditor.colors.purple'),
        pink: t('blockEditor.colors.pink'),
        red: t('blockEditor.colors.red'),
      },
      bold: t('blockEditor.ui.bold'),
      italic: t('blockEditor.ui.italic'),
      underline: t('blockEditor.ui.underline'),
      strike: t('blockEditor.ui.strike'),
      code: t('blockEditor.ui.code'),
      link: t('blockEditor.ui.link'),
      linkPlaceholder: t('blockEditor.ui.linkPlaceholder'),
      removeLink: t('blockEditor.ui.removeLink'),
      apply: t('blockEditor.ui.apply'),
      cancel: t('blockEditor.ui.cancel'),
      open: t('blockEditor.ui.open'),
      mention: t('blockEditor.ui.mention'),
      undo: t('blockEditor.ui.undo'),
      redo: t('blockEditor.ui.redo'),
      formatting: t('blockEditor.ui.formatting'),
      blockMenu: t('blockEditor.ui.blockMenu'),
      dragHandle: t('blockEditor.ui.dragHandle'),
      addBelow: t('blockEditor.ui.addBelow'),
      toggleOpen: t('blockEditor.ui.toggleOpen'),
      toggleClosed: t('blockEditor.ui.toggleClosed'),
      checkbox: t('blockEditor.ui.checkbox'),
    }),
    [t],
  );
}

/** The `/` menu: the text blocks a note is written in. */
export function useSlashItems(): SlashItem[] {
  const { t } = useTranslation();
  return useMemo(() => {
    const words = (list: string) =>
      list
        .split(',')
        .map((word) => word.trim())
        .filter(Boolean);
    const item = (
      id: string,
      group: string,
      type: string,
      props?: Record<string, unknown>,
    ): SlashItem => ({
      id,
      label: t(`blockEditor.slashMenu.${id}.label`),
      description: t(`blockEditor.slashMenu.${id}.description`),
      keywords: words(t(`blockEditor.slashMenu.${id}.keywords`)),
      group,
      action: { kind: 'block', type, props },
    });
    return [
      item('paragraph', 'basic', 'paragraph'),
      item('heading1', 'basic', 'heading_1'),
      item('heading2', 'basic', 'heading_2'),
      item('heading3', 'basic', 'heading_3'),
      item('todo', 'basic', 'todo'),
      item('bulletedList', 'basic', 'bulleted_list_item'),
      item('numberedList', 'basic', 'numbered_list_item'),
      item('toggle', 'basic', 'toggle'),
      item('quote', 'basic', 'quote'),
      item('callout', 'advanced', 'callout'),
      item('code', 'advanced', 'code'),
      item('divider', 'advanced', 'divider'),
      item('toggleHeading1', 'advanced', 'heading_1', { toggleable: true, expanded: true }),
      item('toggleHeading2', 'advanced', 'heading_2', { toggleable: true, expanded: true }),
      item('toggleHeading3', 'advanced', 'heading_3', { toggleable: true, expanded: true }),
    ];
  }, [t]);
}
