import { View } from "react-native";
import { RecordingPill } from "@/components/capture/recording-pill";
import { UndoSnackbar } from "@/components/notes/undo-snackbar";

/** Bloom's shell/footer owns placement and safe-area clearance. */
export function FloatingBottomStack() {
  return <View className="items-center gap-2">
    <UndoSnackbar />
    <RecordingPill />
  </View>;
}
