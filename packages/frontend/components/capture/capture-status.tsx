import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { AlertTriangle, Check, Loader } from 'lucide-react-native';

import { Text } from '@/components/ui/text';
import { useNoteCaptures, type Capture } from '@/lib/capture/captures-repo';
import { retryCapture } from '@/lib/capture/retry';
import { captureStatus } from '@/lib/capture/status';
import { capturesSystemAudio } from '@/lib/capture/support';
import { useColorScheme } from '@/lib/useColorScheme';
import { useTranslation } from '@/hooks/useTranslation';

/**
 * What is happening to this note's recording, in one line.
 *
 * The states are the recording's own — read from the three statuses on the
 * capture row rather than from anything this screen remembers — so a note opened
 * on another screen, or reopened after a restart, says the same thing.
 *
 * Nothing is shown while the microphone is open: the recording pill is already on
 * screen saying exactly that, and two things saying it is one thing too many.
 */
export function CaptureStatusLine({ noteId }: { noteId: string }) {
  const { data: captures } = useNoteCaptures(noteId);
  const { colors } = useColorScheme();
  const { t } = useTranslation();
  const [retrying, setRetrying] = useState(false);

  // Newest first, which is the one the user just made.
  const capture: Capture | undefined = captures[0];
  if (!capture) return null;

  // The reason travels with the lifecycle so the line can name what actually
  // happened. Without it every one of six capability reasons and two output
  // failures rendered as "this device cannot organize them further" — including
  // the ones about the page and the ones a retry fixes.
  const status = captureStatus(capture.lifecycle, capture.enhancementReason);
  if (status.kind === 'idle' || status.kind === 'recording') return null;

  const failed = status.retry !== null || status.kind === 'failed';
  // "Retry" over a finished note reads as "redo everything". Naming what it
  // actually retries is the difference between reassuring and alarming.
  const retryLabelKey =
    status.retry === 'enhancement' ? 'capture.retryEnhancement' : 'capture.retry';

  return (
    <View className="mb-3 gap-1">
      <View className="flex-row items-center gap-2">
        {status.busy ? (
          <Loader size={14} color={colors.mutedForeground} />
        ) : failed ? (
          <AlertTriangle size={14} color={colors.mutedForeground} />
        ) : (
          <Check size={14} color={colors.mutedForeground} />
        )}

        <Text className="flex-1 text-xs text-muted-foreground">{t(status.messageKey)}</Text>

        {status.retry !== null && (
          <Pressable
            disabled={retrying}
            onPress={() => {
              // Disabled while it runs rather than debounced: the repair moves
              // the capture's status first, so a second press would see work in
              // progress — but the button should not invite one.
              setRetrying(true);
              void retryCapture(capture, status.retry).finally(() => setRetrying(false));
            }}
            accessibilityLabel={t(retryLabelKey)}
            className="rounded-full bg-muted px-3 py-1 active:opacity-70"
            hitSlop={6}
          >
            <Text className="text-xs font-medium text-foreground">{t(retryLabelKey)}</Text>
          </Pressable>
        )}
      </View>

      {/* Said once, where the recording is, rather than in a settings screen
          nobody reads: a browser records this machine's microphone, so the other
          people in a call are not in the audio at all. Better stated than
          discovered afterwards from a note with half a meeting in it. */}
      {!capturesSystemAudio() && <Text className="text-xs text-muted-foreground">{t('capture.microphoneOnly')}</Text>}
    </View>
  );
}
