import { View } from "react-native";
import { Button } from "@oxy.so/bloom/button";
import { Card } from "@oxy.so/bloom/card";
import { RiMicLine } from "@oxy.so/bloom/icons/RiMicLine";
import { RiStopFill } from "@oxy.so/bloom/icons/RiStopFill";
import { usePathname } from "expo-router";

import { Text } from "@/components/ui/text";
import { Waveform } from "@/components/capture/waveform";
import { useStartCapture } from "@/lib/capture/use-start-capture";
import { useCaptureStore } from "@/lib/stores/capture-store";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/hooks/useTranslation";
import { showsRecordButton } from "@/lib/capture/surfaces";

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/**
 * The one control for recording.
 *
 * It is a single element in two states rather than a button that summons a bar:
 * pressing it starts the recording and it becomes the recording — same shape,
 * same place, so nothing jumps and there is never a moment where the user has to
 * find where the stop control went.
 *
 * It draws the recording; it does not hold it. `CaptureEngineHost` owns the
 * microphone and publishes to the capture store, which is what makes it safe to
 * render this in more than one place — and it IS rendered twice, since the
 * drawer's scenes and the note editor are different layers of the app and a
 * recording has to be visible and stoppable from both.
 */
export function RecordingPill() {
  const captureId = useCaptureStore((s) => s.captureId);
  const clearCapture = useCaptureStore((s) => s.clearCapture);
  const phase = useCaptureStore((s) => s.phase);
  const levels = useCaptureStore((s) => s.levels);
  const durationMs = useCaptureStore((s) => s.durationMs);
  const partialText = useCaptureStore((s) => s.partialText);
  const stop = useCaptureStore((s) => s.stop);
  const { start, isSupported } = useStartCapture();
  const { t } = useTranslation();
  const pathname = usePathname();

  if (!isSupported) return null;

  const isRecording = captureId !== null;

  // Offering to start a recording belongs with the notes, not on top of
  // settings or a sign-in screen. A recording ALREADY RUNNING is the opposite:
  // it stays visible everywhere, because hiding it would leave the microphone
  // open with no reachable way to stop it.
  if (!isRecording && !showsRecordButton(pathname)) return null;
  const failure =
    phase === "denied"
      ? t("capture.denied")
      : phase === "error"
        ? t("capture.failed")
        : null;

  return (
    <>
      {isRecording ? (
        <View className="items-center gap-2">
        <Card radius="radius-max" elevation="m" style={{ maxWidth: 420, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 10 }}>
          {/* Red is the one colour a recording indicator cannot borrow from the
              theme: it means "live", not "primary". */}
          <View
            className={cn(
              "h-2.5 w-2.5 rounded-full",
              failure ? "bg-muted-foreground" : "bg-red-500",
            )}
          />

          {failure ? (
            <Text className="text-sm text-muted-foreground">{failure}</Text>
          ) : (
            <View className="w-32">
              <Waveform levels={levels} height={22} />
            </View>
          )}

          <Text className="font-mono text-sm tabular-nums text-foreground">
            {formatDuration(durationMs)}
          </Text>

          <Button iconOnly icon={RiStopFill} appearance="subtle" tone="neutral" size="sm"
            onPress={() => {
              // Cleared whatever the outcome: a recorder that failed to save is
              // still not recording, and leaving the pill up would say otherwise.
              // The capture row already carries what went wrong.
              void stop?.().finally(() => clearCapture());
            }}
            accessibilityLabel={t("capture.stop")}
          />
        </Card>

        {/* What is being said right now, before it is part of the transcript.
            Set apart from the note itself, and never written into it: the
            recogniser rewrites this line as it hears more, so it is the one
            place in the app showing text that is still allowed to change under
            the reader. Two lines at most — it is a sign of life, not a
            transcript view. */}
        {partialText !== "" && !failure && (
          <Text
            numberOfLines={2}
            className="max-w-[420px] px-4 text-center text-xs italic text-muted-foreground"
          >
            {partialText}
          </Text>
        )}
        </View>
      ) : (
        <Button icon={RiMicLine} onPress={() => void start()} accessibilityLabel={t("capture.start")}>
          {t("capture.start")}
        </Button>
      )}
    </>
  );
}
