import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Trash2 } from 'lucide-react-native';

import { Text } from '@/components/ui/text';
import {
  deleteRecordingAudio,
  deleteRecordingTranscript,
  useCaptureTranscript,
  useNoteCaptures,
} from '@/lib/capture/captures-repo';
import { regenerateWithProfile } from '@/lib/capture/retry';
import { hasRemovableParts, retentionParts } from '@/lib/capture/retention';
import { CAPTURE_PROFILES } from '@noted/shared-types';
import { useColorScheme } from '@/lib/useColorScheme';
import { useTranslation } from '@/hooks/useTranslation';

/**
 * The two things a person wants to do with a finished recording: say what it was,
 * and stop keeping parts of it.
 *
 * Both are on the note rather than in settings, because both are about THIS
 * recording. A profile is a claim about what was recorded, and the user is the
 * authority on it; a retention choice is about their storage and their privacy,
 * and burying it two screens away is how an hour of audio stays on a phone
 * forever.
 *
 * Each deletion says what it costs before it happens. The consequences are not
 * symmetric — losing the audio costs playback, losing the transcript costs every
 * generated line its evidence — and a control that did not say so would be a
 * control that surprises people.
 */
export function RecordingControls({ noteId }: { noteId: string }) {
  const { data: captures } = useNoteCaptures(noteId);
  const capture = captures[0];
  const { data: segments } = useCaptureTranscript(capture?.id);
  const { colors } = useColorScheme();
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  if (!capture) return null;

  const parts = retentionParts({
    audioPath: capture.audioPath,
    segmentCount: segments.length,
  });

  return (
    <View className="mt-4 gap-3 rounded-xl border border-border p-3">
      <View className="gap-2">
        <Text className="text-xs font-medium text-muted-foreground">
          {t('capture.profile.title')}
        </Text>
        <View className="flex-row flex-wrap gap-1.5">
          {CAPTURE_PROFILES.map((profile) => (
            <Pressable
              key={profile}
              disabled={busy}
              onPress={() => {
                // Stored first, then the note is written again: a profile the
                // user picked that did not change the note is a setting that
                // does nothing.
                setBusy(true);
                void regenerateWithProfile(capture, profile).finally(() => setBusy(false));
              }}
              className={
                capture.profile === profile
                  ? 'rounded-full bg-primary px-3 py-1.5'
                  : 'rounded-full bg-muted px-3 py-1.5 active:opacity-70'
              }
            >
              <Text
                className="text-xs"
                style={{
                  color:
                    capture.profile === profile ? colors.primaryForeground : colors.foreground,
                }}
              >
                {t(`capture.profile.${profile}`)}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {hasRemovableParts({ audioPath: capture.audioPath, segmentCount: segments.length }) && (
        <View className="gap-2 border-t border-border pt-3">
          <Text className="text-xs font-medium text-muted-foreground">
            {t('capture.retention.title')}
          </Text>

          {parts
            .filter((part) => part.present)
            .map((part) => (
              <View key={part.kind} className="flex-row items-center gap-2">
                <View className="flex-1">
                  <Text className="text-xs text-foreground">{t(`capture.retention.${part.kind}`)}</Text>
                  {/* Said before it happens, not after. */}
                  <Text className="text-xs text-muted-foreground">
                    {t(part.costKey)} {t(part.keepsKey)}
                  </Text>
                </View>
                <Pressable
                  disabled={busy}
                  onPress={() => {
                    setBusy(true);
                    const work =
                      part.kind === 'audio'
                        ? deleteRecordingAudio(capture)
                        : deleteRecordingTranscript(capture);
                    void work.finally(() => setBusy(false));
                  }}
                  accessibilityLabel={t(`capture.retention.${part.kind}`)}
                  className="h-8 w-8 items-center justify-center rounded-full bg-muted active:opacity-70"
                  hitSlop={6}
                >
                  <Trash2 size={14} color={colors.foreground} />
                </Pressable>
              </View>
            ))}
        </View>
      )}
    </View>
  );
}
