/**
 * Transcribing a recording once it has stopped.
 *
 * The other path — whisper.cpp streaming while the meeting runs — is better when
 * it is available, because the note fills in as people talk. This is what
 * happens when it is not: in a browser, where `MediaRecorder` hands back a
 * finished blob rather than live samples, and on a phone whose owner has not
 * downloaded a speech model but recorded anyway.
 *
 * Nothing here is awaited by the recorder. Transcribing an hour-long meeting
 * takes minutes, and a stop button that waits for it is a stop button that looks
 * broken; the capture row carries the state, so the work is visible without
 * blocking the person who pressed stop.
 */

import { createLogger } from '@oxyhq/core/logger';

import { appendSegments, completeCapture, failCapture } from '@/lib/capture/captures-repo';
import { enhanceNote, restructureNote } from '@/lib/capture/restructure';
import { loadSetting, SETTING_KEYS } from '@/lib/db/settings-repo';
import { getSttEngine } from '@/lib/stt/engine';
import { DEFAULT_STT_MODEL, type SttModelId } from '@/lib/stt/models';

const logger = createLogger('NotedSTT');

function isLanguage(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export interface DeferredTranscription {
  captureId: string;
  noteId: string;
  audioPath: string;
  startedAt: Date;
  model?: SttModelId;
}

/**
 * Transcribe a finished recording and write the note from it.
 *
 * Segments are persisted before the note is built, so a tab closed mid-way keeps
 * what was understood and the work is not repeated from scratch.
 */
export async function transcribeAfterStop(request: DeferredTranscription): Promise<void> {
  const engine = getSttEngine();
  if (!engine.isSupported()) return;
  if (request.audioPath === '') return;

  // Read here rather than passed in: the recorder has no business knowing about
  // transcription settings, and this runs after it has already finished.
  const language = await loadSetting(SETTING_KEYS.sttLanguage, isLanguage, 'auto');

  try {
    const segments = await engine.transcribe({
      audioPath: request.audioPath,
      captureId: request.captureId,
      model: request.model ?? DEFAULT_STT_MODEL,
      language,
    });

    if (segments.length === 0) {
      // A recording of silence is not a failure, but it is not a note either.
      // Marked complete so nothing retries it forever.
      await completeCapture(request.captureId);
      return;
    }

    await appendSegments(segments);
    await restructureNote(request.captureId, request.noteId, request.startedAt);
    await completeCapture(request.captureId);

    // Only after the note exists: the model is the improvement, never the
    // thing standing between the user and having a note at all.
    await enhanceNote(request.captureId, request.noteId, request.startedAt, language).catch(
      (error: unknown) => {
        logger.error('Could not enhance the note', { error: String(error) });
      },
    );
  } catch (error) {
    logger.error('Could not transcribe the recording', { error: String(error) });
    // The audio is still on disk (or still in the page), so this is recoverable
    // rather than lost — which is why the capture is marked failed rather than
    // deleted.
    await failCapture(request.captureId, 'transcribe').catch(() => undefined);
  }
}
