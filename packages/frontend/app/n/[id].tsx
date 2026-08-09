import React from "react";
import {
  View,
  ScrollView,
  TextInput,
  Pressable,
  ActivityIndicator,
  useWindowDimensions,
  Platform,
} from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  FadeInDown,
  FadeOutDown,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FloatingBottomStack } from "@/components/floating-bottom-stack";
import { useLocalSearchParams, useRouter, useNavigation } from "expo-router";
import { useOxy } from "@oxyhq/services";
import {
  ArrowLeft,
  Pin,
  PinOff,
  Archive,
  ArchiveRestore,
  Trash2,
  Palette,
  Tag,
  Paperclip,
  Bell,
  CheckSquare,
  Type,
  Download,
} from "lucide-react-native";
import { Text } from "@/components/ui/text";
import { toast } from "@oxyhq/bloom/toast";
import { createLogger } from "@oxyhq/core/logger";
import { noteFilename, noteToMarkdown } from "@/lib/export/markdown";
import { saveTextFile } from "@/lib/export/save";
import { NoteColorPicker } from "@/components/notes/note-color-picker";
import { ChecklistEditor } from "@/components/notes/checklist-editor";
import { MarkdownBodyEditor } from "@/components/notes/markdown-body-editor";
import { LabelChips } from "@/components/notes/label-chips";
import { LabelAssignDialog } from "@/components/notes/label-assign-dialog";
import { AttachmentsRow } from "@/components/notes/attachments/AttachmentsRow";
import type { FileMetadata } from "@oxyhq/core";
import { useColorScheme } from "@/lib/useColorScheme";
import { useTranslation } from "@/hooks/useTranslation";
import { useDebouncedCallback } from "@/lib/hooks/use-debounced-callback";
import {
  useNote,
  useCreateNote,
  useUpdateNote,
  useTrashNote,
  makeDraftNote,
} from "@/lib/hooks/use-notes";
import { useLabels } from "@/lib/hooks/use-labels";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";
import { getNoteColorTint } from "@/lib/note-colors";
import { generateUUID } from "@/lib/utils";
import type { ChecklistItem, Note, NoteColor } from "@noted/shared-types";

const AUTOSAVE_MS = 600;

type ReminderPreset = "laterToday" | "tomorrow" | "nextWeek";

function presetDate(preset: ReminderPreset): Date {
  const d = new Date();
  if (preset === "laterToday") {
    d.setHours(18, 0, 0, 0);
    if (d.getTime() < Date.now()) d.setTime(Date.now() + 60 * 60 * 1000);
  } else if (preset === "tomorrow") {
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
  } else {
    d.setDate(d.getDate() + 7);
    d.setHours(9, 0, 0, 0);
  }
  return d;
}

const logger = createLogger("NotedNotes");

export default function NoteEditorScreen() {
  const params = useLocalSearchParams<{ id: string; mode?: string }>();
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { colors, colorScheme } = useColorScheme();
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const { isAuthenticated, showBottomSheet } = useOxy();
  const reduceMotion = useReducedMotion();

  const isNew = params.id === "new";
  const startInChecklist = params.mode === "checklist";

  const { data: fetchedNote, isLoading } = useNote(isNew ? undefined : params.id);
  const { data: labels } = useLabels();
  const createNote = useCreateNote();
  const updateNote = useUpdateNote();
  const trashNote = useTrashNote();

  // The note id we PATCH against. Starts null for `n/new` until the first save
  // creates a server note; thereafter all edits PATCH this id.
  const noteIdRef = React.useRef<string | null>(isNew ? null : params.id);
  const creatingRef = React.useRef(false);

  // Local draft is the source of truth while editing; autosave pushes it up.
  // A ref mirrors the draft so handlers can read the latest value and call the
  // persist side-effect outside of the state updater (no effects-in-setState).
  const [draft, setDraftState] = React.useState<Note>(() => makeDraftNote());
  const draftRef = React.useRef(draft);
  const [hydrated, setHydrated] = React.useState(isNew);
  const [showChecklist, setShowChecklist] = React.useState(startInChecklist);
  const [showColors, setShowColors] = React.useState(false);
  const [labelDialogOpen, setLabelDialogOpen] = React.useState(false);
  const [showReminders, setShowReminders] = React.useState(false);

  const setDraft = React.useCallback((next: Note) => {
    draftRef.current = next;
    setDraftState(next);
  }, []);

  // Hydrate the draft once the fetched note arrives (existing notes only).
  // Calling setState during render is React's documented pattern for syncing
  // state to changed props (here: the async-loaded note).
  if (!isNew && !hydrated && fetchedNote) {
    // Belt-and-suspenders: `useNote` already normalizes via `fetchNote`, but a
    // legacy note that reached the cache by any other path could still lack
    // `attachments`. Guarantee an array before it becomes the editor draft so
    // every read below (filter/spread/length) is safe.
    const hydratedNote: Note = {
      ...fetchedNote,
      attachments: Array.isArray(fetchedNote.attachments)
        ? fetchedNote.attachments
        : [],
    };
    draftRef.current = hydratedNote;
    setDraftState(hydratedNote);
    setShowChecklist(hydratedNote.checklist.length > 0);
    setHydrated(true);
  }

  const persist = React.useCallback(
    (next: Note) => {
      if (!isAuthenticated) return;

      const id = noteIdRef.current;
      if (id) {
        updateNote.mutate({
          id,
          patch: {
            title: next.title,
            body: next.body,
            checklist: next.checklist,
            color: next.color,
            labels: next.labels,
            pinned: next.pinned,
            archived: next.archived,
            reminderAt: next.reminderAt,
            attachments: next.attachments,
          },
        });
        return;
      }

      // First save for a brand-new note: create once, then route to its id so
      // subsequent edits PATCH the real server note.
      const isEmpty =
        !next.title.trim() &&
        !next.body.trim() &&
        next.checklist.length === 0 &&
        (next.attachments?.length ?? 0) === 0;
      if (isEmpty || creatingRef.current) return;

      creatingRef.current = true;
      createNote.mutate(
        {
          title: next.title,
          body: next.body,
          checklist: next.checklist,
          color: next.color,
          labels: next.labels,
          pinned: next.pinned,
          reminderAt: next.reminderAt,
        },
        {
          onSuccess: (created) => {
            noteIdRef.current = created.id;
            creatingRef.current = false;
            router.setParams({ id: created.id });
          },
          onError: () => {
            creatingRef.current = false;
          },
        }
      );
    },
    [isAuthenticated, updateNote, createNote, router]
  );

  const autosave = useDebouncedCallback(persist, AUTOSAVE_MS);

  // Commit any pending autosave when leaving the editor.
  React.useEffect(() => {
    const unsub = navigation.addListener("beforeRemove", () => {
      autosave.flush();
    });
    return unsub;
  }, [navigation, autosave]);

  // Apply a draft change locally and schedule a debounced autosave (typing).
  const update = React.useCallback(
    (patch: Partial<Note>) => {
      const next = { ...draftRef.current, ...patch };
      setDraft(next);
      autosave.run(next);
    },
    [autosave, setDraft]
  );

  // A field change that should save immediately (toggles), not debounced.
  const updateNow = React.useCallback(
    (patch: Partial<Note>) => {
      const next = { ...draftRef.current, ...patch };
      setDraft(next);
      autosave.cancel();
      persist(next);
    },
    [autosave, persist, setDraft]
  );

  const handleExport = React.useCallback(() => {
    const note = draftRef.current;
    // Read from the ref rather than from `draft`, so what is exported is what is
    // on screen right now and not the render this handler was created in.
    void saveTextFile(noteFilename(note), noteToMarkdown(note)).catch((error: unknown) => {
      logger.error('Could not export the note', { error: String(error) });
      toast.error(t("notes.exportFailed"));
    });
  }, [t]);

  const handleToggleChecklist = React.useCallback(() => {
    const prev = draftRef.current;
    let next: Note;
    if (showChecklist) {
      // checklist -> body: join items back into lines
      const body = [prev.body, ...prev.checklist.map((c) => c.text)]
        .filter(Boolean)
        .join("\n");
      next = { ...prev, body, checklist: [] };
    } else {
      // body -> checklist: split body lines into items
      const items: ChecklistItem[] = prev.body
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((text) => ({ id: generateUUID(), text, checked: false }));
      next = { ...prev, body: "", checklist: items };
    }
    setDraft(next);
    autosave.run(next);
    setShowChecklist((s) => !s);
  }, [showChecklist, autosave, setDraft]);

  const handleToggleLabel = React.useCallback(
    (labelId: string) => {
      const prev = draftRef.current;
      const has = prev.labels.includes(labelId);
      const nextLabels = has
        ? prev.labels.filter((l) => l !== labelId)
        : [...prev.labels, labelId];
      updateNow({ labels: nextLabels });
    },
    [updateNow]
  );

  // Append Oxy file IDs to the draft, deduped, and persist immediately. The
  // attachments are just file IDs of any type (no per-note upload), so
  // autosave/create carries them up like any other field.
  const attachFileIds = React.useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      const current = draftRef.current.attachments ?? [];
      const existing = new Set(current);
      const next = [...current];
      for (const id of ids) {
        if (!existing.has(id)) {
          existing.add(id);
          next.push(id);
        }
      }
      if (next.length !== current.length) {
        updateNow({ attachments: next });
      }
    },
    [updateNow]
  );

  const handleAttachFile = React.useCallback(() => {
    showBottomSheet?.({
      screen: "FileManagement",
      props: {
        selectMode: true,
        multiSelect: true,
        afterSelect: "back",
        initialSelectedIds: draftRef.current.attachments ?? [],
        onSelect: (file: FileMetadata) => {
          attachFileIds([file.id]);
        },
        onConfirmSelection: (files: FileMetadata[]) => {
          attachFileIds(files.map((f) => f.id));
        },
      },
    });
  }, [showBottomSheet, attachFileIds]);

  const handleRemoveAttachment = React.useCallback(
    (id: string) => {
      updateNow({
        attachments: (draftRef.current.attachments ?? []).filter(
          (i) => i !== id
        ),
      });
    },
    [updateNow]
  );

  const handleSetReminder = React.useCallback(
    (preset: ReminderPreset) => {
      updateNow({ reminderAt: presetDate(preset).toISOString() });
      setShowReminders(false);
    },
    [updateNow]
  );

  const handleClearReminder = React.useCallback(() => {
    updateNow({ reminderAt: null });
    setShowReminders(false);
  }, [updateNow]);

  const handleTrash = React.useCallback(() => {
    autosave.flush();
    const id = noteIdRef.current;
    if (id) trashNote.mutate(id);
    router.back();
  }, [autosave, trashNote, router]);

  if (!isNew && isLoading && !hydrated) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator color={colors.primary} />
        {/* Carried by the loading state too: a recording does not pause while a
            note loads, so neither should the thing that says so. */}
        <FloatingBottomStack />
      </View>
    );
  }

  const tint = getNoteColorTint(draft.color, colorScheme);
  const backgroundColor = tint ? tint.background : colors.background;
  const allLabels = labels ?? [];
  const isLargeScreen = width >= 768;
  // On web at desktop widths the editor renders as a centered modal overlay
  // (Keep-style); native and small web keep the full-screen editor.
  const isWebModal = Platform.OS === "web" && isLargeScreen;

  const IconButton = ({
    icon: Icon,
    label,
    onPress,
    active,
  }: {
    icon: typeof Pin;
    label: string;
    onPress: () => void;
    active?: boolean;
  }) => (
    <Pressable
      onPress={onPress}
      accessibilityLabel={label}
      className="h-10 w-10 items-center justify-center rounded-full active:bg-foreground/10"
      style={active ? { backgroundColor: colors.foreground + "1a" } : undefined}
    >
      <Icon size={20} color={colors.foreground} />
    </Pressable>
  );

  const editorContent = (
    <>
      {/* Top bar */}
      <View
        className="flex-row items-center px-1"
        style={{ paddingTop: isWebModal ? 0 : insets.top }}
      >
        <View className="h-14 flex-row items-center">
          <IconButton icon={ArrowLeft} label={t("common.back")} onPress={() => router.back()} />
        </View>
        <View className="ml-auto flex-row items-center">
          <IconButton
            icon={draft.pinned ? PinOff : Pin}
            label={draft.pinned ? t("notes.unpin") : t("notes.pin")}
            onPress={() => updateNow({ pinned: !draft.pinned })}
            active={draft.pinned}
          />
          <IconButton icon={Bell} label={t("notes.reminder")} onPress={() => setShowReminders((s) => !s)} />
          <IconButton
            icon={draft.archived ? ArchiveRestore : Archive}
            label={draft.archived ? t("notes.unarchive") : t("notes.archive")}
            onPress={() => updateNow({ archived: !draft.archived })}
          />
          <IconButton icon={Trash2} label={t("common.delete")} onPress={handleTrash} />
        </View>
      </View>

      {/* Reminder presets */}
      {showReminders && (
        <View className="mx-3 mb-1 flex-row flex-wrap gap-2 rounded-xl border border-border bg-card p-2">
          <ReminderChip label={t("notes.laterToday")} onPress={() => handleSetReminder("laterToday")} />
          <ReminderChip label={t("notes.tomorrow")} onPress={() => handleSetReminder("tomorrow")} />
          <ReminderChip label={t("notes.nextWeek")} onPress={() => handleSetReminder("nextWeek")} />
          {draft.reminderAt && (
            <ReminderChip label={t("notes.clearReminder")} onPress={handleClearReminder} destructive />
          )}
        </View>
      )}

      <ScrollView
        className="flex-1"
        contentContainerClassName="px-4 pb-32 pt-1"
        keyboardShouldPersistTaps="handled"
        style={
          isLargeScreen && !isWebModal
            ? { maxWidth: 720, width: "100%", alignSelf: "center" }
            : undefined
        }
      >
        {(draft.attachments?.length ?? 0) > 0 && (
          <View className="mb-3">
            <AttachmentsRow
              attachments={draft.attachments ?? []}
              variant="editor"
              onRemove={handleRemoveAttachment}
            />
          </View>
        )}

        <TextInput
          value={draft.title}
          onChangeText={(title) => update({ title })}
          placeholder={t("notes.titlePlaceholder")}
          placeholderTextColor={colors.mutedForeground}
          className="py-2 text-xl font-semibold text-foreground"
          multiline
        />

        {showChecklist ? (
          <ChecklistEditor
            items={draft.checklist}
            onChange={(checklist) => update({ checklist })}
          />
        ) : (
          <MarkdownBodyEditor
            value={draft.body}
            onChangeMarkdown={(body) => update({ body })}
            placeholder={t("notes.takeANote")}
          />
        )}

        {draft.labels.length > 0 && (
          <LabelChips labelIds={draft.labels} allLabels={allLabels} />
        )}
      </ScrollView>

      {/* Color picker strip */}
      {showColors && (
        <View className="border-t border-border bg-card px-2 py-2">
          <NoteColorPicker
            selected={draft.color}
            onSelect={(color: NoteColor) => updateNow({ color })}
          />
        </View>
      )}

      {/* Bottom toolbar */}
      <View
        className="flex-row items-center gap-1 border-t border-border px-2"
        style={{ paddingBottom: isWebModal ? 0 : insets.bottom, backgroundColor }}
      >
        <View className="h-12 flex-row items-center gap-1">
          <IconButton icon={Paperclip} label={t("notes.attachFile")} onPress={handleAttachFile} />
          <IconButton icon={Palette} label={t("notes.color")} onPress={() => setShowColors((s) => !s)} active={showColors} />
          <IconButton icon={Tag} label={t("notes.labels")} onPress={() => setLabelDialogOpen(true)} />
          <IconButton
            icon={showChecklist ? Type : CheckSquare}
            label={showChecklist ? t("notes.convertToText") : t("notes.convertToChecklist")}
            onPress={handleToggleChecklist}
          />
          <IconButton icon={Download} label={t("notes.exportMarkdown")} onPress={handleExport} />
        </View>
      </View>
    </>
  );

  const labelDialog = (
    <LabelAssignDialog
      open={labelDialogOpen}
      onOpenChange={setLabelDialogOpen}
      assigned={draft.labels}
      onToggle={handleToggleLabel}
    />
  );

  // On web at desktop widths the editor floats as a centered card over a dim
  // backdrop (Keep-style). The route is itself a transparentModal, so the
  // grid + sidebar stay mounted and visible behind this overlay — no inner
  // RN <Modal> is needed.
  if (isWebModal) {
    return (
      <Animated.View
        entering={reduceMotion ? undefined : FadeIn.duration(150)}
        exiting={reduceMotion ? undefined : FadeOut.duration(150)}
        className="flex-1 items-center justify-center bg-black/50 px-4"
        style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
      >
        <Pressable
          className="absolute inset-0"
          accessibilityLabel={t("common.close")}
          onPress={() => router.back()}
        />
        <Animated.View
          entering={reduceMotion ? undefined : FadeInDown.duration(200)}
          exiting={reduceMotion ? undefined : FadeOutDown.duration(150)}
          className="max-h-[85%] w-full max-w-[600px] overflow-hidden rounded-2xl shadow-lg"
          style={{ backgroundColor }}
        >
          {editorContent}
        </Animated.View>
        {labelDialog}
        {/* The editor is a sibling route painted above the whole app, so the
            copy of this stack living in the drawer's scenes is behind it. A
            recording has to stay visible and stoppable while a note is open —
            that is the screen someone is on during a meeting. */}
        <FloatingBottomStack />
      </Animated.View>
    );
  }

  // Native and small-web: the editor fills the screen with the note's tint.
  // The transparentModal route still presents it full-bleed (no dim) on top
  // of the grid.
  return (
    <View className="flex-1" style={{ backgroundColor }}>
      {editorContent}
      {labelDialog}
      <FloatingBottomStack />
    </View>
  );
}

function ReminderChip({
  label,
  onPress,
  destructive,
}: {
  label: string;
  onPress: () => void;
  destructive?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="rounded-full border border-border px-3 py-1.5 active:bg-muted"
    >
      <Text
        className={
          destructive
            ? "text-sm font-medium text-destructive"
            : "text-sm font-medium text-foreground"
        }
      >
        {label}
      </Text>
    </Pressable>
  );
}
