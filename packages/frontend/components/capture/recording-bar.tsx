import { View, Pressable } from "react-native";
import { Square } from "lucide-react-native";

import { Text } from "@/components/ui/text";
import { Waveform } from "@/components/capture/waveform";
import { useRecorder } from "@/lib/capture/use-recorder";
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

/**
 * The bar shown while a recording is running.
 *
 * Mounted in the app layout rather than on a screen, so it stays visible
 * wherever the user navigates. That is not decoration: the recording continues
 * across screens and into the background, so a control that disappeared with the
 * screen that started it would leave a microphone the user cannot reach.
 *
 * It owns the recorder. Only one of these is mounted, which is what guarantees
 * only one recorder exists at a time.
 */
export function RecordingBar() {
  const captureId = useCaptureStore((s) => s.captureId);
  const noteId = useCaptureStore((s) => s.noteId);
  const clearCapture = useCaptureStore((s) => s.clearCapture);
  const { colors } = useColorScheme();
  const { t } = useTranslation();

  const recorder = useRecorder(captureId ?? "", noteId ?? "", captureId !== null, {
    title: t("capture.recording"),
    body: t("capture.notificationBody"),
  });

  if (!captureId) return null;

  const isUnavailable = recorder.phase === "unavailable" || recorder.phase === "error";

  return (
    <View className="flex-row items-center gap-3 border-b border-border bg-background px-4 py-2">
      {/* Red is the one colour a recording indicator cannot borrow from the
          theme: it means "live", not "primary". The theme has no destructive
          token, so it is stated as a class rather than invented as one. */}
      <View
        className={cn(
          "h-2.5 w-2.5 rounded-full",
          isUnavailable ? "bg-muted-foreground" : "bg-red-500",
        )}
      />

      {isUnavailable ? (
        <Text className="flex-1 text-sm text-muted-foreground">
          {t("capture.unavailable")}
        </Text>
      ) : (
        <Waveform levels={recorder.levels} />
      )}

      <Text className="font-mono text-sm tabular-nums text-foreground">
        {formatDuration(recorder.durationMs)}
      </Text>

      <Pressable
        onPress={() => {
          // The store is cleared regardless of the outcome: a recorder that
          // failed to save is still not recording, and leaving the bar up would
          // suggest otherwise. The capture row already carries what went wrong.
          void recorder.stop().finally(() => clearCapture());
        }}
        accessibilityLabel={t("capture.stop")}
        className="h-9 w-9 items-center justify-center rounded-full active:bg-muted"
        hitSlop={8}
      >
        <Square size={16} color={colors.foreground} fill={colors.foreground} />
      </Pressable>
    </View>
  );
}
