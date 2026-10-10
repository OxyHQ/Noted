import React from "react";
import { View, Pressable, TextInput } from "react-native";
import Animated, { LinearTransition, FadeIn } from "react-native-reanimated";
import { CheckSquare, X, Palette, Paperclip, Archive } from "lucide-react-native";
import { Text } from "@/components/ui/text";
import { NoteColorPicker } from "@/components/notes/note-color-picker";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getNoteColorTint } from "@/lib/note-colors";
import { useColorScheme } from "@/lib/useColorScheme";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";
import { useTranslation } from "@/hooks/useTranslation";
import { DEFAULT_NEW_NOTE_COLOR, type NoteColor } from "@noted/shared-types";

interface QuickCaptureProps {
  /** Create a plain note from the composed title/body/color. */
  onCreate: (input: { title: string; body: string; color?: NoteColor; archived?: boolean }) => Promise<{ id: string }>;
  onOpenNote: (id: string, mode: "checklist" | "attachment") => void;
  /** Open the full editor in checklist mode for a new note. */
  onCreateChecklist: () => void;
  /** Open the full editor for a new note with an attachment. */
  onCreateAttachment: () => void;
}

/** Small circular toolbar button used in the expanded composer. */
function ToolButton({
  icon: Icon,
  label,
  color,
  onPress,
  active,
  activeColor,
  disabled,
}: {
  icon: typeof Palette;
  label: string;
  color: string;
  onPress: () => void;
  active?: boolean;
  activeColor?: string;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityState={{ disabled }}
      accessibilityLabel={label}
      className="h-9 w-9 items-center justify-center rounded-full web:transition active:bg-foreground/10 web:hover:bg-foreground/10"
    >
      <Icon size={18} color={active && activeColor ? activeColor : color} />
    </Pressable>
  );
}

/**
 * Home-screen quick-capture bar. Collapsed it shows a single "Take a note…"
 * affordance with checklist + image shortcuts; tapping expands it to a title +
 * body composer that commits on close (Keep-style — no explicit save button).
 * The composer card tints to the selected note color.
 */
export function QuickCapture({
  onCreate,
  onOpenNote,
  onCreateChecklist,
  onCreateAttachment,
}: QuickCaptureProps) {
  const { t } = useTranslation();
  const { colors, colorScheme } = useColorScheme();
  const reduceMotion = useReducedMotion();
  const [expanded, setExpanded] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [body, setBody] = React.useState("");
  const [color, setColor] = React.useState<NoteColor>(DEFAULT_NEW_NOTE_COLOR);
  const [colorOpen, setColorOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [saveFailed, setSaveFailed] = React.useState(false);
  const [discardOpen, setDiscardOpen] = React.useState(false);
  const savingRef = React.useRef(false);
  const bodyRef = React.useRef<TextInput>(null);

  const tint = getNoteColorTint(color, colorScheme);

  const reset = React.useCallback(() => {
    setTitle("");
    setBody("");
    setColor(DEFAULT_NEW_NOTE_COLOR);
    setColorOpen(false);
    setExpanded(false);
    setSaveFailed(false);
    setDiscardOpen(false);
  }, []);

  const commit = React.useCallback(async (archived = false, mode?: "checklist" | "attachment") => {
    if (savingRef.current) return;
    const trimmedTitle = title.trim();
    const trimmedBody = body.trim();
    if (!trimmedTitle && !trimmedBody) {
      reset();
      if (mode === "checklist") onCreateChecklist();
      if (mode === "attachment") onCreateAttachment();
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setSaveFailed(false);
    try {
      const created = await onCreate({ title: trimmedTitle, body: trimmedBody, color, archived });
      reset();
      if (mode) onOpenNote(created.id, mode);
    } catch {
      // The mutation reports its error; keep the complete draft available to retry.
      setSaveFailed(true);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [title, body, color, onCreate, onOpenNote, onCreateChecklist, onCreateAttachment, reset]);

  const expand = React.useCallback(() => {
    setExpanded(true);
    // Focus the body after the layout expands.
    requestAnimationFrame(() => bodyRef.current?.focus());
  }, []);

  const layout = reduceMotion ? undefined : LinearTransition.duration(200);
  const fadeIn = reduceMotion ? undefined : FadeIn.duration(180);

  if (!expanded) {
    return (
      <Animated.View
        layout={layout}
        entering={fadeIn}
        className="w-full max-w-[600px] self-center flex-row items-center rounded-xl border border-border bg-card px-4 shadow-sm web:transition web:hover:shadow-md"
      >
        <Pressable onPress={expand} className="h-12 flex-1 justify-center">
          <Text className="text-base text-muted-foreground">
            {t("notes.takeANote")}
          </Text>
        </Pressable>
        <Pressable
          onPress={onCreateChecklist}
          accessibilityLabel={t("notes.newChecklist")}
          className="h-10 w-10 items-center justify-center rounded-full web:transition active:bg-muted web:hover:bg-muted"
        >
          <CheckSquare size={20} className="text-muted-foreground" />
        </Pressable>
        <Pressable
          onPress={onCreateAttachment}
          accessibilityLabel={t("notes.attachFile")}
          className="h-10 w-10 items-center justify-center rounded-full web:transition active:bg-muted web:hover:bg-muted"
        >
          <Paperclip size={20} className="text-muted-foreground" />
        </Pressable>
      </Animated.View>
    );
  }

  return (
    <Animated.View
      layout={layout}
      entering={fadeIn}
      className="w-full max-w-[600px] self-center rounded-xl border border-border px-4 py-2 shadow-md"
      style={{
        backgroundColor: tint ? tint.background : colors.card,
        borderColor: tint ? tint.border : colors.border,
      }}
    >
      <TextInput
        editable={!saving}
        accessibilityLabel={t("notes.titlePlaceholder")}
        value={title}
        onChangeText={setTitle}
        placeholder={t("notes.titlePlaceholder")}
        placeholderTextColor={colors.mutedForeground}
        className="py-2 text-base font-medium text-foreground"
        returnKeyType="next"
        onSubmitEditing={() => bodyRef.current?.focus()}
      />
      <TextInput
        editable={!saving}
        accessibilityLabel={t("notes.takeANote")}
        ref={bodyRef}
        value={body}
        onChangeText={setBody}
        placeholder={t("notes.takeANote")}
        placeholderTextColor={colors.mutedForeground}
        className="min-h-[44px] py-1 text-base text-foreground"
        multiline
      />
      {saveFailed && <Text accessibilityRole="alert" className="py-2 text-sm text-destructive">{t("notes.quickSaveFailed")}</Text>}
      <View className="mt-1 flex-row items-center justify-between">
        <View className="flex-row items-center gap-0.5">
          <ToolButton
            icon={CheckSquare}
            label={t("notes.newChecklist")}
            color={colors.mutedForeground}
            disabled={saving}
            onPress={() => { void commit(false, "checklist"); }}
          />
          <ToolButton
            icon={Palette}
            label={t("notes.color")}
            color={colors.mutedForeground}
            disabled={saving}
            onPress={() => setColorOpen(true)}
            active={color !== DEFAULT_NEW_NOTE_COLOR}
            activeColor={colors.foreground}
          />
          <ToolButton
            icon={Paperclip}
            label={t("notes.attachFile")}
            color={colors.mutedForeground}
            disabled={saving}
            onPress={() => { void commit(false, "attachment"); }}
          />
          <ToolButton
            icon={Archive}
            label={t("notes.archive")}
            color={colors.mutedForeground}
            disabled={saving}
            onPress={() => { void commit(true); }}
          />
        </View>
        <Pressable
          disabled={saving}
          onPress={() => { void commit(); }}
          className="h-9 items-center justify-center rounded-lg px-4 web:transition active:bg-foreground/10 web:hover:bg-foreground/10"
        >
          <Text className="text-sm font-semibold text-foreground">
            {t(saving ? "notes.saveStatus.saving" : "common.close")}
          </Text>
        </Pressable>
      </View>
      <Pressable
        disabled={saving}
        onPress={() => title.trim() || body.trim() ? setDiscardOpen(true) : reset()}
        accessibilityLabel={t("common.cancel")}
        className="absolute right-2 top-2 h-7 w-7 items-center justify-center rounded-full web:transition active:bg-foreground/10 web:hover:bg-foreground/10"
      >
        <X size={14} color={colors.mutedForeground} />
      </Pressable>

      <Dialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("notes.discardDraftTitle")}</DialogTitle></DialogHeader>
          <Text className="text-sm text-muted-foreground">{t("notes.discardDraftSubtitle")}</Text>
          <View className="flex-row justify-end gap-4">
            <Pressable onPress={() => setDiscardOpen(false)}><Text>{t("notes.keepEditing")}</Text></Pressable>
            <Pressable onPress={reset}><Text className="text-destructive">{t("notes.discardDraft")}</Text></Pressable>
          </View>
        </DialogContent>
      </Dialog>
      <Dialog open={colorOpen} onOpenChange={setColorOpen}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>{t("notes.pickColor")}</DialogTitle>
          </DialogHeader>
          <NoteColorPicker
            selected={color}
            onSelect={(next: NoteColor) => {
              setColor(next);
              setColorOpen(false);
            }}
            scroll={false}
          />
        </DialogContent>
      </Dialog>
    </Animated.View>
  );
}
