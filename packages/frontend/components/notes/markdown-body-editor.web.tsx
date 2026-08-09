import React from "react";
import { TextInput } from "react-native";

import { useColorScheme } from "@/lib/useColorScheme";
import type { MarkdownBodyEditorProps } from "@/components/notes/markdown-body-editor";

/** An empty note still needs somewhere inviting to start writing. */
const MIN_BODY_HEIGHT = 160;

/**
 * The note body in a browser: a plain field.
 *
 * `react-native-enriched-markdown` ships a real web build, but only of its
 * READ-ONLY renderer — `EnrichedMarkdownTextInput` exists on iOS and Android
 * and nowhere else. Importing it here resolves to `undefined`, which React
 * reports as "Element type is invalid" and takes the whole screen down. That is
 * exactly what shipping the shared component to web did.
 *
 * So the browser keeps the plain field, which never lost anything: Markdown is
 * the stored format either way, and the same note opened on a phone gets the
 * formatted editor. Rendering it read-only here — with the renderer the library
 * DOES ship for web — is worth doing, and is a separate change from stopping
 * the crash.
 *
 * The field measures its own content and grows, so the page scrolls rather than
 * a box scrolling inside a half-empty note.
 */
export function MarkdownBodyEditor({
  value,
  onChangeMarkdown,
  placeholder,
}: MarkdownBodyEditorProps) {
  const { colors } = useColorScheme();
  const [height, setHeight] = React.useState(MIN_BODY_HEIGHT);

  return (
    <TextInput
      value={value}
      onChangeText={onChangeMarkdown}
      placeholder={placeholder}
      placeholderTextColor={colors.mutedForeground}
      className="py-1 text-base text-foreground"
      multiline
      textAlignVertical="top"
      scrollEnabled={false}
      onContentSizeChange={(event) => setHeight(event.nativeEvent.contentSize.height)}
      // The one value that cannot be a class, because it is measured.
      style={{ height: Math.max(MIN_BODY_HEIGHT, height) }}
    />
  );
}
