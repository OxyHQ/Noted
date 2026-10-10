import { Button, GlyphButton } from "@oxy.so/bloom/button";
import { Card } from "@oxy.so/bloom/card";
import { TextFieldInput } from "@oxy.so/bloom/text-field";
import { scopedAttachmentSelection } from "@/lib/shared-storage";
import React from "react";
import { LocalStoreBoundary } from "@/components/local-store-boundary";
import { EmptyState } from "@/components/empty-state";
import { NoteSaveQueue } from "@/lib/notes/save-queue";
import { editorPatch, type EditorSaveSnapshot } from "@/lib/notes/editor-patch";
import { getActiveViewerId } from "@/lib/db/client";
import {
  View,
  ScrollView,
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
import { usePreventRemove } from "expo-router/react-navigation";

import { FloatingBottomStack } from "@/components/floating-bottom-stack";
import { useLocalSearchParams, useRouter, useNavigation } from "expo-router";
import { useOxy } from "@oxy.so/services";
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
import { toast } from "@oxy.so/bloom/toast";
import { createLogger } from "@oxy.so/core/logger";
import { noteFilename, noteToMarkdown } from "@/lib/export/markdown";
import { saveTextFile } from "@/lib/export/save";
import { NoteColorPicker } from "@/components/notes/note-color-picker";
import { CaptureStatusLine } from "@/components/capture/capture-status";
import { TranscriptPanel } from "@/components/capture/transcript-panel";
import { RecordingControls } from "@/components/capture/recording-controls";
import { ChecklistEditor } from "@/components/notes/checklist-editor";
import { recordChecklistOverrides } from "@/lib/artifact/record-checklist";
import { MarkdownBodyEditor } from "@/components/notes/markdown-body-editor";
import { LabelChips } from "@/components/notes/label-chips";
import { LabelAssignDialog } from "@/components/notes/label-assign-dialog";
import { AttachmentsRow } from "@/components/notes/attachments/AttachmentsRow";
import type { FileMetadata } from "@oxy.so/core";
import { useColorScheme } from "@/lib/useColorScheme";
import { useTranslation } from "@/hooks/useTranslation";
import { useDebouncedCallback } from "@/lib/hooks/use-debounced-callback";
import {
  useNote,
  useCreateNote,
  useUpdateNote,
  useTrashNote,
  useDeleteNote,
  makeDraftNote,
} from "@/lib/hooks/use-notes";
import { useLabels } from "@/lib/hooks/use-labels";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";
import type { LocalNote } from "@/lib/db/notes-repo";
import { reconcileDraft } from "@/lib/notes/draft-sync";
import { userBodyOf } from "@/lib/notes/generated-body";
import { isEmptyNote } from "@/lib/notes/emptiness";
import { getNoteColorTint } from "@/lib/note-colors";
import { generateUUID } from "@/lib/utils";
import type { ChecklistItem, NoteColor } from "@noted/shared-types";

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
  const router = useRouter();
  const { t } = useTranslation();
  const { colors } = useColorScheme();
  return (
    <LocalStoreBoundary
      fallbackHeader={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("common.back")}
          onPress={() =>
            router.canGoBack() ? router.back() : router.replace("/")
          }
          className="flex-row items-center gap-2 px-4 py-4"
        >
          <ArrowLeft size={20} color={colors.foreground} />
          <Text>{t("notes.title")}</Text>
        </Pressable>
      }
    >
      <NoteEditor />
    </LocalStoreBoundary>
  );
}

function NoteEditor() {
  const params = useLocalSearchParams<{
    id: string;
    mode?: string;
    label?: string;
  }>();
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { colors, colorScheme } = useColorScheme();
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const { isAuthenticated, showBottomSheet, user, activeSessionId } = useOxy();
  const editorOwner = React.useRef(user?.id);
  const attachmentIdentity = React.useRef({
    accountId: user?.id ?? null,
    sessionId: activeSessionId ?? null,
  });
  attachmentIdentity.current = {
    accountId: user?.id ?? null,
    sessionId: activeSessionId ?? null,
  };
  const reduceMotion = useReducedMotion();

  const isNew = params.id === "new";
  const startInChecklist = params.mode === "checklist";

  const {
    data: fetchedNote,
    isLoading,
    error: loadError,
  } = useNote(isNew ? undefined : params.id);
  const { data: labels } = useLabels();
  const createNote = useCreateNote();
  const updateNote = useUpdateNote();
  const trashNote = useTrashNote();
  const deleteNote = useDeleteNote();

  // The note id we PATCH against. Starts null for `n/new` until the first save
  // creates a server note; thereafter all edits PATCH this id.
  const noteIdRef = React.useRef<string | null>(isNew ? null : params.id);
  const allowLeaveRef = React.useRef(false);
  const leavingRef = React.useRef(false);
  const saveVersion = React.useRef(0);
  const editVersion = React.useRef(0);
  const [saveState, setSaveState] = React.useState<
    "saved" | "unsaved" | "saving" | "error"
  >("saved");

  // The draft the fields render from. A text input cannot be re-rendered from
  // the database on every keystroke and still keep a caret, so the editor holds
  // its own copy — but it is no longer the sole source of truth, because a
  // recording rewrites this note while it is open. `base` is the version the
  // draft last agreed with the store on, and it is what lets the two be merged
  // instead of one of them winning. A ref mirrors the draft so handlers can read
  // the latest value and persist outside the state updater.
  const [draft, setDraftState] = React.useState<LocalNote>(() => ({
    ...makeDraftNote(),
    labels: isNew && params.label ? [params.label] : [],
  }));
  const draftRef = React.useRef(draft);
  const [base, setBase] = React.useState<LocalNote | null>(null);
  const baseRef = React.useRef(base);
  baseRef.current = base;
  const lastSavedDraft = React.useRef<LocalNote | null>(null);
  const [showChecklist, setShowChecklist] = React.useState(startInChecklist);
  const [showColors, setShowColors] = React.useState(false);
  const [labelDialogOpen, setLabelDialogOpen] = React.useState(false);
  const [showReminders, setShowReminders] = React.useState(false);

  const setDraft = React.useCallback((next: LocalNote) => {
    editVersion.current++;
    draftRef.current = next;
    setDraftState(next);
  }, []);

  // Follow the store, on first load and on every write that lands after it —
  // the recorder's slices included. Calling setState during render is React's
  // documented pattern for syncing state to changed props (here: the note, read
  // through a live SQL subscription).
  //
  // Live-query snapshots are the gate: two writes can share an updatedAt
  // millisecond, so timestamps cannot establish that the store is unchanged.
  const stored = isNew ? null : fetchedNote;
  if (stored !== null && (base === null || base.id !== stored.id)) {
    // First sight of this note: there is nothing of the user's to protect yet.
    draftRef.current = stored;
    setDraftState(stored);
    baseRef.current = stored;
    setBase(stored);
    // Only on arrival. Flipping this on a later slice would drag someone out of
    // the field they are typing in because the structurer found a task.
    setShowChecklist(stored.checklist.length > 0);
  } else if (
    stored !== null &&
    base !== null &&
    base !== stored
  ) {
    // Written to since the draft last agreed with it — a transcription slice, a
    // sync from another device, or this editor's own autosave landing.
    const next = reconcileDraft(base, draftRef.current, stored);
    draftRef.current = next;
    setDraftState(next);
    baseRef.current = stored;
    setBase(stored);
  }

  /**
   * Write the draft.
   *
   * `bodyTakenOver` is set by the one action that turns the app's half into the
   * user's: converting between a body and a checklist moves every line,
   * generated ones included, into something they now own. Without it the store
   * would compose the block back in on the very next write, just after they
   * converted it away.
   */
  const writeDraft = async ({ draft: next, base: queuedBase }: EditorSaveSnapshot, bodyTakenOver: boolean) => {
    if (
      !isAuthenticated ||
      !editorOwner.current ||
      user?.id !== editorOwner.current ||
      getActiveViewerId() !== editorOwner.current
    ) {
      throw new Error(
        "The active account changed before this write could be saved",
      );
    }
    const userBody = userBodyOf(next.body, next.generatedBody);
    const id = noteIdRef.current;
    const input = editorPatch(id ? queuedBase ?? lastSavedDraft.current : null, next, bodyTakenOver);
    if (id) {
      if (Object.keys(input).length > 0) {
        await updateNote.mutateAsync({
          id,
          patch: input,
          expectedViewerId: editorOwner.current,
        });
      }
      lastSavedDraft.current = next;
    } else if (!isEmptyNote({ ...next, userBody })) {
      const created = await createNote.mutateAsync({
        ...input,
        expectedViewerId: editorOwner.current,
      });
      noteIdRef.current = created.id;
      lastSavedDraft.current = next;
      baseRef.current = created;
      setBase(created);
      router.setParams({ id: created.id });
    }
  };
  const writeDraftRef = React.useRef(writeDraft);
  writeDraftRef.current = writeDraft;
  const [saveQueue] = React.useState(
    () =>
      new NoteSaveQueue<EditorSaveSnapshot>((next, takeOverBody) =>
        writeDraftRef.current(next, takeOverBody),
      ),
  );
  React.useEffect(() => () => saveQueue.cancelPending(), [saveQueue]);
  const persist = React.useCallback(
    async (next: LocalNote, bodyTakenOver = false) => {
      const version = ++saveVersion.current;
      setSaveState("saving");
      try {
        await saveQueue.save({ draft: next, base: baseRef.current }, bodyTakenOver);
        if (version === saveVersion.current) setSaveState("saved");
      } catch (error) {
        if (version === saveVersion.current) setSaveState("error");
        throw error;
      }
    },
    [saveQueue],
  );

  const autosave = useDebouncedCallback(() => {
    void persist(draftRef.current).catch(() => {});
  }, AUTOSAVE_MS);

  // Keep the editor mounted until its last local write succeeds. A failed disk
  // write leaves the draft visible with a retry action instead of losing it.
  usePreventRemove(isNew || base !== null, (event) => {
    if (allowLeaveRef.current) {
      navigation.dispatch(event.data.action);
      return;
    }
    if (leavingRef.current) return;
    leavingRef.current = true;
    autosave.cancel();
    void (async () => {
      let next: LocalNote;
      let version: number;
      do {
        autosave.cancel();
        version = editVersion.current;
        next = draftRef.current;
        await persist(next);
      } while (version !== editVersion.current);
      const id = noteIdRef.current;
      if (
        id &&
        isEmptyNote({
          ...next,
          userBody: userBodyOf(next.body, next.generatedBody),
        })
      ) {
        await deleteNote.mutateAsync(id);
      }
      allowLeaveRef.current = true;
      navigation.dispatch(event.data.action);
    })()
      .catch(() => {
        setSaveState("error");
      })
      .finally(() => {
        leavingRef.current = false;
      });
  });

  // Browser refresh/close cannot await SQLite. Warn only while a draft is at risk.
  React.useEffect(() => {
    if (Platform.OS !== "web" || saveState === "saved") return;
    const protectDraft = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectDraft);
    return () => window.removeEventListener("beforeunload", protectDraft);
  }, [saveState]);

  // Apply a draft change locally and schedule a debounced autosave (typing).
  const update = React.useCallback(
    (patch: Partial<LocalNote>) => {
      const next = { ...draftRef.current, ...patch };
      setDraft(next);
      saveVersion.current++;
      setSaveState("unsaved");
      autosave.run();
    },
    [autosave, setDraft],
  );

  // A field change that should save immediately (toggles), not debounced.
  const updateNow = React.useCallback(
    (patch: Partial<LocalNote>) => {
      const next = { ...draftRef.current, ...patch };
      setDraft(next);
      autosave.cancel();
      void persist(next).catch(() => {});
    },
    [autosave, persist, setDraft],
  );

  const handleExport = React.useCallback(() => {
    const note = draftRef.current;
    // Read from the ref rather than from `draft`, so what is exported is what is
    // on screen right now and not the render this handler was created in.
    void saveTextFile(noteFilename(note), noteToMarkdown(note)).catch(
      (error: unknown) => {
        logger.error("Could not export the note", { error: String(error) });
        toast.error(t("notes.exportFailed"));
      },
    );
  }, [t]);

  const handleToggleChecklist = React.useCallback(() => {
    const prev = draftRef.current;
    let next: LocalNote;
    // Either direction moves every line the app generated into something the
    // user now owns — joined into their body, or split into their checklist —
    // so the app's record of what it wrote is cleared with it.
    if (showChecklist) {
      // checklist -> body: join items back into lines
      const body = [prev.body, ...prev.checklist.map((c) => c.text)]
        .filter(Boolean)
        .join("\n");
      next = { ...prev, body, checklist: [], generatedBody: "" };
    } else {
      // body -> checklist: split body lines into items
      const items: ChecklistItem[] = prev.body
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((text) => ({ id: generateUUID(), text, checked: false }));
      next = { ...prev, body: "", checklist: items, generatedBody: "" };
    }
    setDraft(next);
    autosave.cancel();
    void persist(next, true).catch(() => {});
    setShowChecklist((s) => !s);
  }, [showChecklist, autosave, setDraft, persist]);

  const handleToggleLabel = React.useCallback(
    (labelId: string) => {
      const prev = draftRef.current;
      const has = prev.labels.includes(labelId);
      const nextLabels = has
        ? prev.labels.filter((l) => l !== labelId)
        : [...prev.labels, labelId];
      updateNow({ labels: nextLabels });
    },
    [updateNow],
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
    [updateNow],
  );

  const handleAttachFile = React.useCallback(() => {
    const select = scopedAttachmentSelection(
      attachmentIdentity.current,
      () => attachmentIdentity.current,
      attachFileIds,
    );
    showBottomSheet?.({
      screen: "FileManagement",
      props: {
        selectMode: true,
        multiSelect: true,
        afterSelect: "back",
        initialSelectedIds: draftRef.current.attachments ?? [],
        onSelect: (file: FileMetadata) => {
          select([file.id]);
        },
        onConfirmSelection: (files: FileMetadata[]) => {
          select(files.map((f) => f.id));
        },
      },
    });
  }, [showBottomSheet, attachFileIds]);

  const handleRemoveAttachment = React.useCallback(
    (id: string) => {
      updateNow({
        attachments: (draftRef.current.attachments ?? []).filter(
          (i) => i !== id,
        ),
      });
    },
    [updateNow],
  );

  const handleSetReminder = React.useCallback(
    (preset: ReminderPreset) => {
      updateNow({ reminderAt: presetDate(preset).toISOString() });
      setShowReminders(false);
    },
    [updateNow],
  );

  const handleClearReminder = React.useCallback(() => {
    updateNow({ reminderAt: null });
    setShowReminders(false);
  }, [updateNow]);

  const handleTrash = React.useCallback(async () => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    autosave.cancel();
    try {
      let version: number;
      do {
        autosave.cancel();
        version = editVersion.current;
        await persist(draftRef.current);
      } while (version !== editVersion.current);
      const id = noteIdRef.current;
      if (id) await trashNote.mutateAsync(id);
      allowLeaveRef.current = true;
      router.back();
    } catch {
      setSaveState("error");
    } finally {
      leavingRef.current = false;
    }
  }, [autosave, persist, trashNote, router]);

  const checklistOpened = React.useRef(false);
  React.useEffect(() => {
    if (
      params.mode !== "checklist" ||
      isNew ||
      !base ||
      checklistOpened.current
    )
      return;
    checklistOpened.current = true;
    if (!showChecklist) handleToggleChecklist();
  }, [params.mode, isNew, base, showChecklist, handleToggleChecklist]);

  const attachmentOpened = React.useRef(false);
  React.useEffect(() => {
    if (params.mode !== "attachment" || attachmentOpened.current) return;
    attachmentOpened.current = true;
    handleAttachFile();
  }, [params.mode, handleAttachFile]);

  if (!isNew && !isLoading && (loadError || !fetchedNote) && !base) {
    return (
      <View className="flex-1 bg-background">
        <EmptyState
          sticker={loadError ? "loadError" : "notFound"}
          title={t(loadError ? "notes.loadFailed" : "notes.notFoundTitle")}
          subtitle={t(
            loadError ? "notes.loadFailedSubtitle" : "notes.notFoundSubtitle",
          )}
          action={{
            label: t("common.back"),
            onPress: () =>
              router.canGoBack() ? router.back() : router.replace("/"),
          }}
        />
      </View>
    );
  }

  if (!isNew && isLoading && base === null) {
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

  const editorContent = (
    <>
      {/* Top bar */}
      <View
        className="flex-row items-center px-1"
        style={{ paddingTop: isWebModal ? 0 : insets.top }}
      >
        <View className="h-14 flex-row items-center">
          <IconButton
            icon={ArrowLeft}
            label={t("common.back")}
            onPress={() => router.back()}
          />
        </View>
        <View className="ml-auto flex-row items-center">
          <IconButton
            icon={draft.pinned ? PinOff : Pin}
            label={draft.pinned ? t("notes.unpin") : t("notes.pin")}
            onPress={() => updateNow({ pinned: !draft.pinned })}
            active={draft.pinned}
          />
          <IconButton
            icon={Bell}
            label={t("notes.reminder")}
            onPress={() => setShowReminders((s) => !s)}
          />
          <IconButton
            icon={draft.archived ? ArchiveRestore : Archive}
            label={draft.archived ? t("notes.unarchive") : t("notes.archive")}
            onPress={() => updateNow({ archived: !draft.archived })}
          />
          <IconButton
            icon={Trash2}
            label={t("common.delete")}
            onPress={handleTrash}
          />
        </View>
      </View>

      <View
        className="flex-row items-center justify-between px-4 pb-1"
        accessibilityLiveRegion="polite"
      >
        <Text
          className={
            saveState === "error"
              ? "text-xs text-destructive"
              : "text-xs text-muted-foreground"
          }
        >
          {t(`notes.saveStatus.${saveState}`)}
        </Text>
        {saveState === "error" && (
          <Button
            appearance="plain"
            size="sm"
            onPress={() => {
              autosave.cancel();
              void persist(draftRef.current).catch(() => {});
            }}
          >
            {t("common.retry")}
          </Button>
        )}
      </View>

      {/* Reminder presets */}
      {showReminders && (
        <View className="mx-3 mb-1 flex-row flex-wrap gap-2 rounded-xl border border-border bg-card p-2">
          <ReminderChip
            label={t("notes.laterToday")}
            onPress={() => handleSetReminder("laterToday")}
          />
          <ReminderChip
            label={t("notes.tomorrow")}
            onPress={() => handleSetReminder("tomorrow")}
          />
          <ReminderChip
            label={t("notes.nextWeek")}
            onPress={() => handleSetReminder("nextWeek")}
          />
          {draft.reminderAt && (
            <ReminderChip
              label={t("notes.clearReminder")}
              onPress={handleClearReminder}
              destructive
            />
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

        {/* What is happening to this note's recording, read from the capture row
            rather than from anything this screen remembers — so it says the same
            thing after a restart, and offers the same repair. */}
        <CaptureStatusLine noteId={isNew ? "" : params.id} />

        <TextFieldInput
          label={t("notes.titlePlaceholder")}
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
            onChange={(checklist) => {
              // The list write keeps the screen honest now; the overrides keep it
              // honest after the next finalisation. Without them the next pass
              // rebuilds the artifact, finds no record that anybody touched a
              // generated item, and the tick disappears minutes later.
              void recordChecklistOverrides(
                params.id,
                draft.checklist,
                checklist,
              );
              update({ checklist });
            }}
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

        {/* What was actually said, for when the note is not enough. Collapsed by
            default: a note is the handful of things worth reading again, and
            opening the transcript unasked puts the work the app exists to save
            back in front of the reader. */}
        <TranscriptPanel noteId={isNew ? "" : params.id} />

        {/* What this recording was, and what it is still keeping. Both belong on
            the note rather than in settings: both are about THIS recording, and
            burying retention two screens away is how an hour of audio stays on a
            phone forever. */}
        <RecordingControls noteId={isNew ? "" : params.id} />
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
        style={{
          paddingBottom: isWebModal ? 0 : insets.bottom,
          backgroundColor,
        }}
      >
        <View className="h-12 flex-row items-center gap-1">
          <IconButton
            icon={Paperclip}
            label={t("notes.attachFile")}
            onPress={handleAttachFile}
          />
          <IconButton
            icon={Palette}
            label={t("notes.color")}
            onPress={() => setShowColors((s) => !s)}
            active={showColors}
          />
          <IconButton
            icon={Tag}
            label={t("notes.labels")}
            onPress={() => setLabelDialogOpen(true)}
          />
          <IconButton
            icon={showChecklist ? Type : CheckSquare}
            label={
              showChecklist
                ? t("notes.convertToText")
                : t("notes.convertToChecklist")
            }
            onPress={handleToggleChecklist}
          />
          <IconButton
            icon={Download}
            label={t("notes.exportMarkdown")}
            onPress={handleExport}
          />
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
          className="h-[85%] w-full max-w-[720px]"
        >
          <Card
            radius="radius-16"
            clipContent
            elevation="m"
            style={{ backgroundColor, flex: 1 }}
            contentStyle={{ flex: 1 }}
          >
            {editorContent}
          </Card>
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

// Keep toolbar hosts mounted when a checklist field commits on blur. Replacing
// them between pointer-down and pointer-up loses the button press.
function IconButton({
  icon: Icon,
  label,
  onPress,
  active,
}: {
  icon: typeof Pin;
  label: string;
  onPress: () => void;
  active?: boolean;
}) {
  return (
    <GlyphButton
      onPress={onPress}
      accessibilityLabel={label}
      pressed={active}
      size={40}
      glyphSize={20}
    >
      {(foreground) => <Icon size={20} color={foreground} />}
    </GlyphButton>
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
    <Button
      appearance="outline"
      tone={destructive ? "danger" : "neutral"}
      size="sm"
      onPress={onPress}
    >
      {label}
    </Button>
  );
}
