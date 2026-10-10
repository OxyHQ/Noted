import React from "react";
import { TextInput, View } from "react-native";
import { useTheme } from "@oxy.so/bloom/theme";
import {
  EnrichedMarkdownText,
  type MarkdownStyle,
} from "react-native-enriched-markdown";

import { useColorScheme } from "@/lib/useColorScheme";
import { markdownOffsetForRenderedPrefix } from "@/lib/markdown/caret";
import type { MarkdownBodyEditorProps } from "@/components/notes/markdown-body-editor";

/** An empty note still needs somewhere inviting to start writing. */
const MIN_BODY_HEIGHT = 160;

/**
 * The note body in a browser: read as a document, edited as text.
 *
 * `react-native-enriched-markdown` ships a real web build, but only of its
 * READ-ONLY renderer — `EnrichedMarkdownTextInput` exists on iOS and Android and
 * nowhere else. Importing that here resolves to `undefined`, which React reports
 * as "Element type is invalid" and takes the whole screen down.
 *
 * So the browser had a plain field, and a generated note read as its own
 * plumbing: `## Decisions` and leading dashes, which is half of what #59 was
 * about. This uses the renderer the library DOES ship for web, and keeps the
 * plain field for when the user is actually typing.
 *
 * ## One note, two presentations — not two editors
 *
 * There is one string, the Markdown, and it is what is stored, synced, exported
 * and handed to the structurer. The renderer never edits it and the field never
 * formats it; they are two ways of showing the same value, and which one is on
 * screen is a function of whether the caret is in it. Nothing merges, so nothing
 * can disagree.
 *
 * ## Why the click position is worth this much trouble
 *
 * A reading surface you can only edit from the end is not an editor. The browser
 * can say where in the RENDERED text a click landed, and that offset means
 * nothing to a field holding Markdown — "Decisions" starts at 0 on screen and at
 * 3 in the source. `markdownOffsetForRenderedPrefix` aligns the two, so clicking
 * a word puts the caret on that word.
 */
export function MarkdownBodyEditor({
  value,
  onChangeMarkdown,
  placeholder,
}: MarkdownBodyEditorProps) {
  const { colors } = useColorScheme();
  const linkColor = useTheme().colors.primarySubtleForeground;
  // The renderer gives every block its own light-mode defaults; setting the
  // container color cannot override them. Pair all text and filled surfaces
  // with Bloom tokens so opening a note reads like its editable field.
  const markdownStyle = React.useMemo<MarkdownStyle>(
    () => ({
      paragraph: { color: colors.foreground },
      h1: { color: colors.foreground },
      h2: { color: colors.foreground },
      h3: { color: colors.foreground },
      h4: { color: colors.foreground },
      h5: { color: colors.foreground },
      h6: { color: colors.foreground },
      strong: { color: colors.foreground },
      em: { color: colors.foreground },
      list: {
        color: colors.foreground,
        bulletColor: colors.mutedForeground,
        markerColor: colors.mutedForeground,
      },
      blockquote: {
        color: colors.foreground,
        backgroundColor: colors.muted,
        borderColor: colors.border,
      },
      code: {
        color: colors.foreground,
        backgroundColor: colors.muted,
        borderColor: colors.border,
      },
      codeBlock: {
        color: colors.foreground,
        backgroundColor: colors.muted,
        borderColor: colors.border,
      },
      table: {
        color: colors.foreground,
        headerTextColor: colors.foreground,
        headerBackgroundColor: colors.muted,
        rowEvenBackgroundColor: "transparent",
        rowOddBackgroundColor: colors.muted,
        borderColor: colors.border,
      },
      taskList: {
        checkedTextColor: colors.mutedForeground,
        checkedColor: colors.primary,
        checkmarkColor: colors.primaryForeground,
        borderColor: colors.mutedForeground,
      },
      link: { color: linkColor },
      strikethrough: { color: colors.mutedForeground },
      underline: { color: colors.foreground },
      thematicBreak: { color: colors.border },
      math: { color: colors.foreground, backgroundColor: colors.muted },
      inlineMath: { color: colors.foreground },
      highlight: {
        color: colors.primaryForeground,
        backgroundColor: colors.primary,
      },
      spoiler: { color: colors.mutedForeground },
    }),
    [colors, linkColor],
  );
  const [height, setHeight] = React.useState(MIN_BODY_HEIGHT);
  const [editing, setEditing] = React.useState(false);

  // Where the field should put the caret when it opens. A ref and not state: it
  // must not cause a render of its own, and it is only ever meaningful in the
  // instant between the click and the focus.
  const caretRef = React.useRef<number | null>(null);

  // React 19 ids carry punctuation that react-native-web rewrites on its way to
  // the DOM, so the string here would stop matching the attribute there.
  const rawId = React.useId().replace(/[^a-zA-Z0-9]/g, "");
  const readerId = `note-body-reader-${rawId}`;
  const fieldId = `note-body-field-${rawId}`;

  // An empty note has nothing to render and everything to invite: it opens as
  // the field, so the placeholder is somewhere the user can click and type.
  const showField = editing || value.trim().length === 0;

  React.useEffect(() => {
    if (showField) return;
    const reader = document.getElementById(readerId);
    if (!reader) return;

    function onClick(event: MouseEvent) {
      // A click that ends a text selection is somebody quoting the note, not
      // somebody editing it. Opening the field would throw their selection away.
      if (window.getSelection()?.isCollapsed === false) return;
      // A link in a note is for following.
      if ((event.target as HTMLElement | null)?.closest("a")) return;

      const prefix = renderedPrefixAt(reader as HTMLElement, event);
      caretRef.current =
        prefix === null ? null : markdownOffsetForRenderedPrefix(value, prefix);
      setEditing(true);
    }

    reader.addEventListener("click", onClick);
    return () => reader.removeEventListener("click", onClick);
  }, [showField, readerId, value]);

  React.useEffect(() => {
    if (!showField) return;
    const field = document.getElementById(fieldId);
    if (
      !(
        field instanceof HTMLTextAreaElement ||
        field instanceof HTMLInputElement
      )
    )
      return;

    field.focus();
    const caret = caretRef.current;
    caretRef.current = null;
    if (caret !== null) field.setSelectionRange(caret, caret);
  }, [showField, fieldId]);

  if (!showField) {
    return (
      <View id={readerId} style={{ minHeight: MIN_BODY_HEIGHT }}>
        <EnrichedMarkdownText
          markdown={value}
          // Styled with values rather than classes, the same exception the phone
          // makes and for the same reason: NativeWind's `className` only reaches
          // components its interop knows, and a class on a third-party view is
          // silently inert — unstyled text with no error to explain it.
          containerStyle={{
            paddingVertical: 4,
            color: colors.foreground,
            fontSize: 16,
          }}
          markdownStyle={markdownStyle}
          // Notes are not papers. Loading a maths typesetter for a shopping list
          // is a download the user never asked for.
          md4cFlags={{ latexMath: false }}
        />
      </View>
    );
  }

  return (
    <TextInput
      id={fieldId}
      value={value}
      onChangeText={onChangeMarkdown}
      onBlur={() => setEditing(false)}
      placeholder={placeholder}
      placeholderTextColor={colors.mutedForeground}
      className="py-1 text-base text-foreground"
      multiline
      textAlignVertical="top"
      scrollEnabled={false}
      onContentSizeChange={(event) =>
        setHeight(event.nativeEvent.contentSize.height)
      }
      // The page scrolls, not the field: a box that scrolls inside a half-empty
      // note is the thing this replaced. The one value that cannot be a class,
      // because it is measured.
      style={{ height: Math.max(MIN_BODY_HEIGHT, height) }}
    />
  );
}

/** The visible text from the start of the note to where the user clicked. */
function renderedPrefixAt(
  container: HTMLElement,
  event: MouseEvent,
): string | null {
  const point = caretPoint(event);
  if (!point) return null;

  const range = document.createRange();
  range.setStart(container, 0);
  range.setEnd(point.node, point.offset);
  return range.toString();
}

/**
 * Which character the pointer was over.
 *
 * Two APIs for one question, because no single one of them is in every engine
 * the app runs in: `caretPositionFromPoint` is the standard and is in Firefox
 * and recent Chrome, `caretRangeFromPoint` is the older one and is in Safari.
 */
function caretPoint(event: MouseEvent): { node: Node; offset: number } | null {
  if (typeof document.caretPositionFromPoint === "function") {
    const position = document.caretPositionFromPoint(
      event.clientX,
      event.clientY,
    );
    return position
      ? { node: position.offsetNode, offset: position.offset }
      : null;
  }
  if (typeof document.caretRangeFromPoint === "function") {
    const range = document.caretRangeFromPoint(event.clientX, event.clientY);
    return range
      ? { node: range.startContainer, offset: range.startOffset }
      : null;
  }
  return null;
}
