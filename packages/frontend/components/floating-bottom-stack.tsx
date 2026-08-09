import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { RecordingPill } from "@/components/capture/recording-pill";
import { UndoSnackbar } from "@/components/notes/undo-snackbar";

/** Clear of the home indicator and any bottom chrome. */
const BOTTOM_STACK_MARGIN = 16;

/**
 * What floats at the bottom of the app: the recording indicator, and the undo
 * offer for whatever was just archived or deleted.
 *
 * Rendered in TWO places, and it has to be, because they are different layers:
 * inside the drawer's scenes, so an open sidebar covers it exactly as it covers
 * the rest of the screen, and inside the note editor, which is a sibling route
 * painted above all of them. Both copies read from stores; nothing here owns a
 * recording, which is what makes drawing it twice safe.
 *
 * Anchored to the BOTTOM edge on purpose: while recording, the pill carries a
 * live transcription line that the recogniser rewrites as it hears more, so the
 * stack's height changes several times a second. Only its bottom edge is still.
 *
 * It hugs its contents rather than stretching: a full-width layer over the
 * screen would leave everything beneath it depending on `pointerEvents:
 * 'box-none'` surviving every future style change, and there is nothing to see
 * through in the first place.
 */
export function FloatingBottomStack() {
  const insets = useSafeAreaInsets();

  return (
    <View
      className="absolute bottom-0 self-center items-center gap-2"
      style={{ paddingBottom: insets.bottom + BOTTOM_STACK_MARGIN }}
    >
      <UndoSnackbar />
      <RecordingPill />
    </View>
  );
}
