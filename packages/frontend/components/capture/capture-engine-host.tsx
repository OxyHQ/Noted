import { useEffect } from "react";

import { useCaptureEngine } from "@/lib/capture/use-capture-engine";
import { useCaptureStore } from "@/lib/stores/capture-store";
import { useTranslation } from "@/hooks/useTranslation";

/**
 * Holds the microphone. Draws nothing.
 *
 * One mount, in the authenticated layout, for two reasons. A second engine would
 * be a second microphone, and the two would fight over one device — so the
 * indicator cannot simply be rendered wherever it is needed. And the engine
 * reads the local database, which only exists once an account's store is open.
 *
 * What it produces goes into the capture store, which is what the indicator
 * reads. That indirection is what lets the same recording be drawn inside the
 * drawer's scenes (where an open sidebar covers it, as it covers everything
 * else on the screen) and inside the note editor (a sibling route painted above
 * all of them) without either copy owning the recording.
 */
export function CaptureEngineHost() {
  const captureId = useCaptureStore((s) => s.captureId);
  const noteId = useCaptureStore((s) => s.noteId);
  const publishLive = useCaptureStore((s) => s.publishLive);
  const { t } = useTranslation();

  const recorder = useCaptureEngine(
    captureId ?? "",
    noteId ?? "",
    captureId !== null,
    {
      title: t("capture.recording"),
      body: t("capture.notificationBody"),
    },
  );

  const { phase, levels, durationMs, partialText, stop } = recorder;

  // An effect because this is publication to another system, not derived state:
  // the engine's values arrive several times a second from a microphone, and
  // writing to the store during render would be a side effect in a pure pass.
  useEffect(() => {
    if (captureId === null) return;
    publishLive({ phase, levels, durationMs, partialText, stop });
  }, [captureId, phase, levels, durationMs, partialText, stop, publishLive]);

  return null;
}
