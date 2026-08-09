import React from "react";
import {
  EnrichedMarkdownTextInput,
  type EnrichedMarkdownTextInputInstance,
} from "react-native-enriched-markdown";

import { useColorScheme } from "@/lib/useColorScheme";
import type { MarkdownBodyEditorProps } from "@/components/notes/markdown-body-editor";

/**
 * The note body, edited as formatted text rather than as syntax.
 *
 * The structurer and the language model both write Markdown, and until now the
 * editor showed it raw: `## Decisions` and leading dashes, which is the note's
 * plumbing rather than the note. This renders it as what it means while keeping
 * Markdown as the stored format — nothing about the data model changes, so
 * export, sync and the preview all keep working on the same string.
 *
 * ## Why this wrapper exists
 *
 * The library's input is UNCONTROLLED: `defaultValue` seeds it and
 * `onChangeMarkdown` reports edits. Noted's editor is controlled, and it also
 * writes the body itself — hydrating a note that arrived from the server, and
 * converting a checklist back into text. Neither of those would reach an
 * uncontrolled field.
 *
 * So this presents a controlled interface and pushes changes down imperatively,
 * skipping the ones that came back out of the editor a moment ago. Without that
 * check every keystroke would be echoed back into the field mid-typing, moving
 * the caret to the end.
 */
/** An empty note still needs somewhere inviting to start writing. */
const MIN_BODY_HEIGHT = 160;

export function MarkdownBodyEditor({
  value,
  onChangeMarkdown,
  placeholder,
}: MarkdownBodyEditorProps) {
  const { colors } = useColorScheme();
  const inputRef = React.useRef<EnrichedMarkdownTextInputInstance | null>(null);

  // The last value this component and the field agree on. Anything else arriving
  // in `value` came from outside the editor and has to be pushed down.
  const agreedRef = React.useRef(value);

  React.useEffect(() => {
    if (value === agreedRef.current) return;
    agreedRef.current = value;
    inputRef.current?.setValue(value);
  }, [value]);

  const handleChange = React.useCallback(
    (markdown: string) => {
      agreedRef.current = markdown;
      onChangeMarkdown(markdown);
    },
    [onChangeMarkdown],
  );

  return (
    <EnrichedMarkdownTextInput
      ref={inputRef}
      defaultValue={value}
      onChangeMarkdown={handleChange}
      placeholder={placeholder}
      placeholderTextColor={colors.mutedForeground}
      multiline
      // The page scrolls, not the field: a box that scrolls inside a half-empty
      // note is the thing this replaced.
      scrollEnabled={false}
      // Styled with values rather than classes, which is the exception in this
      // codebase and deliberate: NativeWind's `className` only reaches
      // components its interop knows, and this is a third-party native view. A
      // class here would be silently inert — an unstyled editor with no error to
      // explain it — so the boundary is crossed explicitly.
      style={{
        minHeight: MIN_BODY_HEIGHT,
        paddingVertical: 4,
        color: colors.foreground,
        fontSize: 16,
      }}
      // The library styles inline marks itself; only the link colour is worth
      // taking from the theme, since the rest inherit from `style`.
      markdownStyle={{ link: { color: colors.primary } }}
    />
  );
}
