/**
 * The note body editor — the neutral build, and the shared contract.
 *
 * Metro resolves `markdown-body-editor.native.tsx` on a phone, where
 * `react-native-enriched-markdown` provides a real Markdown editor, and
 * `markdown-body-editor.web.tsx` in a browser, where that library ships only its
 * read-only renderer and the editor component does not exist at all.
 *
 * This file is what a non-Metro resolver gets, and it is a plain field rather
 * than a throw: an editor is the one thing a note screen cannot do without, so
 * degrading to something that types is right where refusing would not be.
 */

import React from "react";
import { TextInput } from "react-native";

import { useColorScheme } from "@/lib/useColorScheme";

export interface MarkdownBodyEditorProps {
  value: string;
  onChangeMarkdown: (markdown: string) => void;
  placeholder: string;
}

export function MarkdownBodyEditor({
  value,
  onChangeMarkdown,
  placeholder,
}: MarkdownBodyEditorProps) {
  const { colors } = useColorScheme();

  return (
    <TextInput
      value={value}
      onChangeText={onChangeMarkdown}
      placeholder={placeholder}
      placeholderTextColor={colors.mutedForeground}
      className="min-h-[160px] py-1 text-base text-foreground"
      multiline
      textAlignVertical="top"
    />
  );
}
