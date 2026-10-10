import { View } from "react-native";
import { useScrollRestoration } from "@oxy.so/bloom/scroll";
import { notesContentStyle, type NotesContentProps } from "./notes-content.types";

/** The browser document scrolls; a second scroll container would trap it. */
export function NotesContent({ children, style, restorationKey, ready = true }: NotesContentProps) {
  useScrollRestoration("window", { key: restorationKey, enabled: ready });
  return <View testID="notes-page-content" style={[notesContentStyle, style]}>{children}</View>;
}
