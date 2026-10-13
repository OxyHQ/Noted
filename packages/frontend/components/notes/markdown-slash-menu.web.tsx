import React from 'react';

import { useTranslation } from '@/hooks/useTranslation';
import { useColorScheme } from '@/lib/useColorScheme';
import {
  SLASH_COMMAND_IDS,
  applySlashCommand,
  filterSlashCommands,
  slashContext,
  type SlashCommand,
  type SlashCommandId,
  type SlashContext,
} from '@/lib/markdown/slash';

interface MarkdownSlashMenuProps {
  /** The DOM id of the field being edited. */
  fieldId: string;
  onChangeMarkdown: (markdown: string) => void;
}

/**
 * The "/" block menu for the web editor.
 *
 * Listens on the field itself rather than wrapping it, so the field stays a
 * plain controlled `<textarea>` and the menu is purely additive. What counts as a
 * slash command and what each one does lives in `lib/markdown/slash.ts`; this
 * only reads the caret, shows the matches and forwards ArrowUp/Down, Enter/Tab
 * and Escape while the list is open. It is listened to in the capture phase so
 * Enter chooses a block instead of inserting a line break first.
 */
export function MarkdownSlashMenu({ fieldId, onChangeMarkdown }: MarkdownSlashMenuProps) {
  const { t } = useTranslation();
  const { colors } = useColorScheme();
  const [context, setContext] = React.useState<SlashContext | null>(null);
  const [active, setActive] = React.useState(0);

  const labels = React.useMemo(
    () =>
      Object.fromEntries(SLASH_COMMAND_IDS.map((id) => [id, t(`editor.slash.${id}`)])) as Record<
        SlashCommandId,
        string
      >,
    [t],
  );
  const matches = React.useMemo(
    () => (context ? filterSlashCommands(context.query, labels) : []),
    [context, labels],
  );
  // The handlers below are registered once, so they read the latest through refs.
  const state = React.useRef({ context, matches, active });
  state.current = { context, matches, active };

  const choose = React.useCallback(
    (command: SlashCommand) => {
      const field = document.getElementById(fieldId);
      const current = state.current.context;
      if (!(field instanceof HTMLTextAreaElement) || !current) return;
      const edit = applySlashCommand(field.value, current, field.selectionStart, command);
      onChangeMarkdown(edit.text);
      setContext(null);
      requestAnimationFrame(() => {
        field.focus();
        field.setSelectionRange(edit.selection.start, edit.selection.end);
      });
    },
    [fieldId, onChangeMarkdown],
  );

  React.useEffect(() => {
    const field = document.getElementById(fieldId);
    if (!(field instanceof HTMLTextAreaElement)) return;

    const refresh = () => {
      const next = slashContext(field.value, field.selectionStart);
      setContext((previous) => {
        if (next === null) return null;
        // Same slash, new query: keep the highlight on the top match.
        if (previous?.start !== next.start || previous.query !== next.query) setActive(0);
        return next;
      });
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const { context: open, matches: list, active: index } = state.current;
      if (!open || list.length === 0) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : list.length - 1;
        setActive((index + step) % list.length);
      } else if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        event.stopPropagation();
        choose(list[Math.min(index, list.length - 1)]);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        setContext(null);
      }
    };

    field.addEventListener('input', refresh);
    field.addEventListener('click', refresh);
    field.addEventListener('keyup', refresh);
    field.addEventListener('blur', () => setContext(null));
    field.addEventListener('keydown', onKeyDown, true);
    return () => {
      field.removeEventListener('input', refresh);
      field.removeEventListener('click', refresh);
      field.removeEventListener('keyup', refresh);
      field.removeEventListener('keydown', onKeyDown, true);
    };
  }, [fieldId, choose]);

  if (!context || matches.length === 0) return null;

  return (
    <div
      role="listbox"
      aria-label={t('editor.slash.title')}
      style={{
        border: `1px solid ${colors.border}`,
        background: colors.card,
        borderRadius: 12,
        padding: 4,
        marginBottom: 4,
        maxHeight: 240,
        overflowY: 'auto',
      }}
    >
      {matches.map((command, index) => (
        <div
          key={command.id}
          role="option"
          aria-selected={index === active}
          // Focusable, not tabbable: the keyboard drives the list from the field.
          tabIndex={-1}
          onKeyDown={(event) => {
            if (event.key === 'Enter') choose(command);
          }}
          // Choosing must not blur the field, or the editor closes under the click.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => choose(command)}
          onMouseEnter={() => setActive(index)}
          style={{
            padding: '8px 10px',
            borderRadius: 8,
            cursor: 'pointer',
            color: colors.foreground,
            background: index === active ? colors.muted : 'transparent',
          }}
        >
          {labels[command.id]}
        </div>
      ))}
    </div>
  );
}
