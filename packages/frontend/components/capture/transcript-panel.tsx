import { useMemo, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { ChevronDown, ChevronRight, Search } from 'lucide-react-native';

import { Text } from '@/components/ui/text';
import { useCaptureTranscript, useNoteCaptures } from '@/lib/capture/captures-repo';
import { searchTranscript, transcriptLines } from '@/lib/capture/transcript-view';
import { useColorScheme } from '@/lib/useColorScheme';
import { useTranslation } from '@/hooks/useTranslation';

/**
 * What was actually said, for when the note is not enough.
 *
 * The app has stored transcript segments since the beginning and never showed
 * them, which left every generated line unverifiable in practice: the evidence
 * existed and there was nowhere to look at it.
 *
 * Collapsed by default, and that is the honest default rather than a timid one. A
 * note is the handful of things worth reading again; the transcript is the source
 * you open when you need to check a wording, and opening it unasked would put the
 * work the app exists to save back in front of the reader.
 */
export function TranscriptPanel({ noteId }: { noteId: string }) {
  const { data: captures } = useNoteCaptures(noteId);
  const capture = captures[0];
  const { data: segments } = useCaptureTranscript(capture?.id);
  const { colors } = useColorScheme();
  const { t } = useTranslation();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const lines = useMemo(() => transcriptLines(segments), [segments]);
  const results = useMemo(() => searchTranscript(lines, query), [lines, query]);
  const shown = query.trim() === '' ? lines.map((line) => ({ line, matches: [] })) : results;

  if (!capture || lines.length === 0) return null;

  return (
    <View className="mt-4 rounded-xl border border-border">
      <Pressable
        onPress={() => setOpen((current) => !current)}
        accessibilityLabel={t('capture.transcript.title')}
        className="flex-row items-center gap-2 px-3 py-2.5 active:opacity-70"
      >
        {open ? (
          <ChevronDown size={16} color={colors.mutedForeground} />
        ) : (
          <ChevronRight size={16} color={colors.mutedForeground} />
        )}
        <Text className="flex-1 text-sm font-medium text-foreground">
          {t('capture.transcript.title')}
        </Text>
        <Text className="text-xs text-muted-foreground">{lines.length}</Text>
      </Pressable>

      {open && (
        <View className="gap-2 border-t border-border px-3 py-3">
          <View className="flex-row items-center gap-2 rounded-lg bg-muted px-2.5 py-1.5">
            <Search size={14} color={colors.mutedForeground} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={t('capture.transcript.search')}
              placeholderTextColor={colors.mutedForeground}
              className="flex-1 text-sm text-foreground"
            />
          </View>

          {shown.length === 0 ? (
            <Text className="py-2 text-xs text-muted-foreground">
              {t('capture.transcript.noMatches')}
            </Text>
          ) : (
            shown.map(({ line, matches }) => (
              <View key={line.id} className="flex-row gap-3 py-1">
                <Text className="w-12 font-mono text-xs tabular-nums text-muted-foreground">
                  {line.offset}
                </Text>
                <Text
                  className={
                    // A provisional line is still allowed to change under the
                    // reader, and saying so is the difference between a
                    // transcript and a guess.
                    line.isFinal
                      ? 'flex-1 text-sm text-foreground'
                      : 'flex-1 text-sm italic text-muted-foreground'
                  }
                >
                  {matches.length === 0 ? line.text : highlight(line.text, matches)}
                </Text>
              </View>
            ))
          )}
        </View>
      )}
    </View>
  );
}

/**
 * The matched stretches, marked.
 *
 * The positions come from the search rather than from a second search here: the
 * search folded accents to find them, and re-deriving the offsets from the
 * displayed text would put every highlight in an accented line in the wrong place.
 */
function highlight(text: string, matches: readonly { start: number; end: number }[]) {
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const [index, match] of matches.entries()) {
    if (match.start > at) parts.push(text.slice(at, match.start));
    parts.push(
      <Text key={`${String(index)}:${String(match.start)}`} className="bg-primary/20 text-foreground">
        {text.slice(match.start, match.end)}
      </Text>,
    );
    at = match.end;
  }
  if (at < text.length) parts.push(text.slice(at));
  return parts;
}
