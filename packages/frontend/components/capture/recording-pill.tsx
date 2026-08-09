import { View, Pressable } from "react-native";
import { Mic, Square } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Text } from "@/components/ui/text";
import { Waveform } from "@/components/capture/waveform";
import { useCaptureEngine } from "@/lib/capture/use-capture-engine";
import { useStartCapture } from "@/lib/capture/use-start-capture";
import { useCaptureStore } from "@/lib/stores/capture-store";
import { useColorScheme } from "@/lib/useColorScheme";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/hooks/useTranslation";

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** Clear of the home indicator and any bottom chrome. */
const BOTTOM_MARGIN = 16;

/**
 * The one control for recording, floating at the bottom centre.
 *
 * It is a single element in two states rather than a button that summons a bar:
 * pressing it starts the recording and it becomes the recording — same shape,
 * same place, so nothing jumps and there is never a moment where the user has to
 * find where the stop control went.
 *
 * Mounted in the app layout, above the navigator, because a recording continues
 * across screens and into the background. A control tied to one screen would
 * strand the microphone somewhere the user cannot reach it.
 */
export function RecordingPill() {
  const captureId = useCaptureStore((s) => s.captureId);
  const noteId = useCaptureStore((s) => s.noteId);
  const clearCapture = useCaptureStore((s) => s.clearCapture);
  const { start, isSupported } = useStartCapture();
  const { colors } = useColorScheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  const recorder = useCaptureEngine(captureId ?? "", noteId ?? "", captureId !== null, {
    title: t("capture.recording"),
    body: t("capture.notificationBody"),
  });

  if (!isSupported) return null;

  const isRecording = captureId !== null;
  const failure =
    recorder.phase === "denied"
      ? t("capture.denied")
      : recorder.phase === "error"
        ? t("capture.failed")
        : null;

  return (
    // Centred by `self-center` rather than by stretching across the screen and
    // centring its contents. A full-width container would be an invisible layer
    // over the whole app — sidebar included — and everything under it would
    // depend on `pointerEvents: 'box-none'` surviving every future style change
    // and platform quirk. Hugging the pill means there is nothing to see
    // through in the first place.
    <View
      className="absolute bottom-0 self-center"
      style={{ paddingBottom: insets.bottom + BOTTOM_MARGIN }}
    >
      {isRecording ? (
        <View className="max-w-[92%] flex-row items-center gap-3 rounded-full border border-border bg-background px-4 py-2.5 shadow-lg">
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
              <Waveform levels={recorder.levels} height={22} />
            </View>
          )}

          <Text className="font-mono text-sm tabular-nums text-foreground">
            {formatDuration(recorder.durationMs)}
          </Text>

          <Pressable
            onPress={() => {
              // Cleared whatever the outcome: a recorder that failed to save is
              // still not recording, and leaving the pill up would say otherwise.
              // The capture row already carries what went wrong.
              void recorder.stop().finally(() => clearCapture());
            }}
            accessibilityLabel={t("capture.stop")}
            className="h-8 w-8 items-center justify-center rounded-full bg-muted active:opacity-70"
            hitSlop={8}
          >
            <Square size={13} color={colors.foreground} fill={colors.foreground} />
          </Pressable>
        </View>
      ) : (
        <Pressable
          onPress={() => void start()}
          accessibilityLabel={t("capture.start")}
          className="flex-row items-center gap-2 rounded-full bg-primary px-5 py-3 shadow-lg active:opacity-90"
        >
          <Mic size={18} color={colors.primaryForeground} />
          <Text
            className="text-sm font-semibold"
            style={{ color: colors.primaryForeground }}
          >
            {t("capture.start")}
          </Text>
        </Pressable>
      )}
    </View>
  );
}
