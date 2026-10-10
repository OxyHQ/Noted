import { useRef } from "react";
import { ScrollView } from "react-native";
import { ScreenScrollView } from "@oxy.so/bloom/screen";
import { useScrollRestoration } from "@oxy.so/bloom/scroll";
import { notesContentStyle, type NotesContentProps } from "./notes-content.types";

/** Native owns a scroll view; Bloom owns its chrome insets and restoration. */
export function NotesContent({ children, style, restorationKey, ready = true }: NotesContentProps) {
  const ref = useRef<ScrollView>(null);
  const restoration = useScrollRestoration(ref, { key: restorationKey, enabled: ready });
  return <ScreenScrollView ref={ref} restoration={restoration} style={{ flex: 1 }}
    contentContainerStyle={[notesContentStyle, style]} keyboardShouldPersistTaps="handled">
    {children}
  </ScreenScrollView>;
}
