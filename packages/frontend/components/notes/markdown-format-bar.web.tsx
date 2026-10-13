import {
  Bold,
  Code,
  Heading2,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Quote,
  SquareCode,
  Strikethrough,
  type LucideIcon,
} from 'lucide-react-native';
import type React from 'react';

import { useTranslation } from '@/hooks/useTranslation';
import { useColorScheme } from '@/lib/useColorScheme';
import {
  insertLink,
  toggleCodeBlock,
  toggleHeading,
  toggleLinePrefix,
  toggleNumberedList,
  toggleWrap,
  type Edit,
  type Selection,
} from '@/lib/markdown/commands';

interface Command {
  key: string;
  icon: LucideIcon;
  /** Translation key under `editor.format`. */
  label: string;
  run: (text: string, selection: Selection) => Edit | null;
}

const COMMANDS: readonly Command[] = [
  { key: 'bold', icon: Bold, label: 'bold', run: (t, s) => toggleWrap(t, s, '**') },
  { key: 'italic', icon: Italic, label: 'italic', run: (t, s) => toggleWrap(t, s, '*') },
  { key: 'strike', icon: Strikethrough, label: 'strike', run: (t, s) => toggleWrap(t, s, '~~') },
  { key: 'code', icon: Code, label: 'code', run: (t, s) => toggleWrap(t, s, '`') },
  { key: 'heading', icon: Heading2, label: 'heading', run: (t, s) => toggleHeading(t, s, 2) },
  { key: 'bullets', icon: List, label: 'bullets', run: (t, s) => toggleLinePrefix(t, s, '- ') },
  { key: 'numbers', icon: ListOrdered, label: 'numbers', run: (t, s) => toggleNumberedList(t, s) },
  {
    key: 'tasks',
    icon: ListChecks,
    label: 'tasks',
    run: (t, s) => toggleLinePrefix(t, s, '- [ ] '),
  },
  { key: 'quote', icon: Quote, label: 'quote', run: (t, s) => toggleLinePrefix(t, s, '> ') },
  { key: 'block', icon: SquareCode, label: 'block', run: (t, s) => toggleCodeBlock(t, s) },
];

interface MarkdownFormatBarProps {
  /** The DOM id of the field being edited. */
  fieldId: string;
  value: string;
  onChangeMarkdown: (markdown: string) => void;
}

/**
 * Formatting buttons for the web editor.
 *
 * The field is a plain `<textarea>` holding Markdown, so a button edits the text
 * around the selection (see `lib/markdown/commands.ts`) and puts the selection
 * back. Two web details matter more than they look: a button press must not take
 * focus from the field (the editor closes itself on blur, so a focus-stealing
 * button would close the editor under the person's cursor), and the selection can
 * only be restored after React has re-rendered the new text.
 */
export function MarkdownFormatBar({ fieldId, value, onChangeMarkdown }: MarkdownFormatBarProps) {
  const { t } = useTranslation();
  const { colors } = useColorScheme();

  const apply = (run: Command['run']) => {
    const field = document.getElementById(fieldId);
    if (!(field instanceof HTMLTextAreaElement)) return;
    const edit = run(value, { start: field.selectionStart, end: field.selectionEnd });
    if (!edit) return;
    onChangeMarkdown(edit.text);
    requestAnimationFrame(() => {
      field.focus();
      field.setSelectionRange(edit.selection.start, edit.selection.end);
    });
  };

  const link = () => {
    const url = window.prompt(t('editor.format.linkPrompt'), 'https://');
    // Only web addresses: a link note is for following, and `javascript:` is not one.
    if (!url || !/^https?:\/\//i.test(url.trim())) return;
    apply((text, selection) => insertLink(text, selection, url.trim()));
  };

  const buttonStyle: React.CSSProperties = {
    all: 'unset',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 32,
    height: 32,
    borderRadius: 8,
    color: colors.mutedForeground,
  };

  const button = (key: string, Icon: LucideIcon, label: string, onClick: () => void) => (
    <button
      key={key}
      type="button"
      title={label}
      aria-label={label}
      style={buttonStyle}
      // The press must not move focus out of the field.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      <Icon size={18} color={colors.mutedForeground} />
    </button>
  );

  return (
    <div
      role="toolbar"
      aria-label={t('editor.format.toolbar')}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 2,
        padding: '2px 0',
        borderBottom: `1px solid ${colors.border}`,
        marginBottom: 4,
      }}
    >
      {COMMANDS.map((command) =>
        button(command.key, command.icon, t(`editor.format.${command.label}`), () =>
          apply(command.run),
        ),
      )}
      {button('link', Link2, t('editor.format.link'), link)}
    </div>
  );
}
