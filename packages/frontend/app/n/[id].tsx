import { Button, GlyphButton } from '@oxy.so/bloom/button';
import { Dialog } from '@oxy.so/bloom/dialog';
import { PageHeader } from '@oxy.so/bloom/page-header';
import { TextFieldInput } from '@oxy.so/bloom/text-field';
import { scopedAttachmentSelection } from '@/lib/shared-storage';
import React from 'react';
import { LocalStoreBoundary } from '@/components/local-store-boundary';
import { EmptyState } from '@/components/empty-state';
import { NoteSaveQueue } from '@/lib/notes/save-queue';
import { editorPatch, type EditorSaveSnapshot } from '@/lib/notes/editor-patch';
import { getActiveViewerId } from '@/lib/db/client';
import { View, ScrollView, ActivityIndicator, useWindowDimensions, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FloatingBottomStack } from '@/components/floating-bottom-stack';
import { useLocalSearchParams, useRouter, usePreventRemove } from 'expo-router';
import { useOxy } from '@oxy.so/services/ui/client';
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
  Download,
  FolderInput,
  History,
  Link2,
} from 'lucide-react-native';
import { Text } from '@/components/ui/text';
import { toast } from '@oxy.so/bloom/toast';
import { useHaptics } from '@oxy.so/bloom/hooks';
import { createLogger } from '@oxy.so/core/logger';
import { noteFilename, noteToMarkdown } from '@/lib/export/markdown';
import { saveTextFile } from '@/lib/export/save';
import { NoteColorPicker } from '@/components/notes/note-color-picker';
import { CaptureStatusLine } from '@/components/capture/capture-status';
import { TranscriptPanel } from '@/components/capture/transcript-panel';
import { RecordingControls } from '@/components/capture/recording-controls';
import { recordChecklistOverrides } from '@/lib/artifact/record-checklist';
import { NoteBlockEditor } from '@/components/notes/note-block-editor';
import { LabelChips } from '@/components/notes/label-chips';
import { LabelAssignDialog } from '@/components/notes/label-assign-dialog';
import { FolderPickerDialog } from '@/components/notes/folder-picker-dialog';
import { LinkedMentions } from '@/components/notes/linked-mentions';
import { LinkNoteDialog } from '@/components/notes/link-note-dialog';
import { ReminderPickerDialog } from '@/components/notes/reminder-picker-dialog';
import { RevisionsDialog } from '@/components/notes/revisions-dialog';
import { linkParagraph, noteMentionSource } from '@/lib/notes/mention-source';
import { generatedTodos, renumber } from '@/lib/notes/blocks';
import { newNoteId } from '@/lib/db/ids';
import { AttachmentsRow } from '@/components/notes/attachments/AttachmentsRow';
import type { FileMetadata } from '@oxy.so/core';
import { useColorScheme } from '@/lib/useColorScheme';
import { useTranslation } from '@/hooks/useTranslation';
import { useDebouncedCallback } from '@/lib/hooks/use-debounced-callback';
import { useOwnedExport } from '@/lib/hooks/use-owned-export';
import {
  useNote,
  useCreateNote,
  useUpdateNote,
  useTrashNote,
  useDeleteNote,
  makeDraftNote,
} from '@/lib/hooks/use-notes';
import { useLabels } from '@/lib/hooks/use-labels';
import type { LocalNote, NoteInput } from '@/lib/db/notes-repo';
import { reconcileDraft } from '@/lib/notes/draft-sync';
import { isEmptyNote } from '@/lib/notes/emptiness';
import { getNoteColorTint } from '@/lib/note-colors';
import type { NoteColor } from '@noted/shared-types';

const AUTOSAVE_MS = 600;

type ReminderPreset = 'laterToday' | 'tomorrow' | 'nextWeek';

function presetDate(preset: ReminderPreset): Date {
  const d = new Date();
  if (preset === 'laterToday') {
    d.setHours(18, 0, 0, 0);
    if (d.getTime() < Date.now()) d.setTime(Date.now() + 60 * 60 * 1000);
  } else if (preset === 'tomorrow') {
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
  } else {
    d.setDate(d.getDate() + 7);
    d.setHours(9, 0, 0, 0);
  }
  return d;
}

const logger = createLogger('NotedNotes');

export default function NoteEditorScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const content = (
    <LocalStoreBoundary
      documentScroll={false}
      fallbackHeader={<PageHeader title={t('notes.title')} onBack={goBack} />}
    >
      <NoteEditor />
    </LocalStoreBoundary>
  );
  // Controlled dismissal asks the router to leave. Its save guard keeps both
  // the route and this surface mounted until the final local write succeeds.
  return Platform.OS === 'web' ? (
    <Dialog
      open
      onClose={goBack}
      label={t('notes.title')}
      maxWidth={720}
      scrollable={false}
      contentPadding={0}
    >
      {content}
    </Dialog>
  ) : (
    content
  );
}

function NoteEditor() {
  const params = useLocalSearchParams<{
    id: string;
    mode?: string;
    label?: string;
    folder?: string;
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, colorScheme } = useColorScheme();
  const { t } = useTranslation();
  const haptic = useHaptics();
  const { width } = useWindowDimensions();
  const { isAuthenticated, showBottomSheet, user, activeSessionId } = useOxy();
  const { run: runExport } = useOwnedExport('local');
  const editorOwner = React.useRef(user?.id);
  const attachmentIdentity = React.useRef({
    accountId: user?.id ?? null,
    sessionId: activeSessionId ?? null,
  });
  attachmentIdentity.current = {
    accountId: user?.id ?? null,
    sessionId: activeSessionId ?? null,
  };

  const isNew = params.id === 'new';
  const startInChecklist = params.mode === 'checklist';

  const { data: fetchedNote, isLoading, error: loadError } = useNote(isNew ? undefined : params.id);
  const { data: labels } = useLabels();
  const createNote = useCreateNote();
  const updateNote = useUpdateNote();
  const trashNote = useTrashNote();
  const deleteNote = useDeleteNote();

  // The note id we PATCH against. Starts null for `n/new` until the first save
  // creates a server note; thereafter all edits PATCH this id.
  const noteIdRef = React.useRef<string | null>(isNew ? null : params.id);
  // Set once the editor's last write succeeded and it lets the route go. It
  // turns the removal guard off: expo-router 58 dispatches a blocked action
  // again only through `repeat`/`disablePrevention`, and the guard's own prop
  // has to agree with that or a re-dispatch is blocked a second time.
  const [leaveAllowed, setLeaveAllowed] = React.useState(false);
  const leavingRef = React.useRef(false);
  const saveVersion = React.useRef(0);
  const editVersion = React.useRef(0);
  const [saveState, setSaveState] = React.useState<'saved' | 'unsaved' | 'saving' | 'error'>(
    'saved',
  );

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
    folderId: isNew && params.folder ? params.folder : null,
    // "New list" starts on a task to type into.
    blocks:
      isNew && startInChecklist
        ? [
            {
              id: newNoteId(),
              parentBlockId: null,
              type: 'todo',
              content: { text: '', checked: false },
              order: 0,
            },
          ]
        : [],
  }));
  const draftRef = React.useRef(draft);
  const [base, setBase] = React.useState<LocalNote | null>(null);
  const baseRef = React.useRef(base);
  baseRef.current = base;
  const lastSavedDraft = React.useRef<LocalNote | null>(null);
  const creationInput = React.useRef<NoteInput | null>(null);
  const [showColors, setShowColors] = React.useState(false);
  const [labelDialogOpen, setLabelDialogOpen] = React.useState(false);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [linkOpen, setLinkOpen] = React.useState(false);
  const [folderOpen, setFolderOpen] = React.useState(false);
  const [reminderPickerOpen, setReminderPickerOpen] = React.useState(false);
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
  } else if (stored !== null && base !== null && base !== stored) {
    // Written to since the draft last agreed with it — a transcription slice, a
    // sync from another device, or this editor's own autosave landing.
    const next = reconcileDraft(base, draftRef.current, stored);
    draftRef.current = next;
    setDraftState(next);
    baseRef.current = stored;
    setBase(stored);
  }

  /** Write the draft: only what the editor changed, merged onto the store's note. */
  const writeDraft = async ({ draft: next, base: queuedBase }: EditorSaveSnapshot) => {
    if (
      !isAuthenticated ||
      !editorOwner.current ||
      user?.id !== editorOwner.current ||
      getActiveViewerId() !== editorOwner.current
    ) {
      throw new Error('The active account changed before this write could be saved');
    }
    const id = noteIdRef.current;
    const input = editorPatch(id ? (queuedBase ?? lastSavedDraft.current) : null, next);
    if (id) {
      if (Object.keys(input).length > 0) {
        await updateNote.mutateAsync({
          id,
          patch: input,
          expectedViewerId: editorOwner.current,
        });
      }
      lastSavedDraft.current = next;
    } else if (!isEmptyNote(next)) {
      creationInput.current ??= input;
      const created = await createNote.mutateAsync({
        ...input,
        creationId: next.id,
        initialInput: creationInput.current,
        expectedViewerId: editorOwner.current,
      });
      noteIdRef.current = created.id;
      lastSavedDraft.current = next;
      // Confirmation may return a note already edited in another tab. Follow
      // those fields while retaining typing made during the pending request.
      const confirmedDraft = reconcileDraft(next, draftRef.current, created);
      draftRef.current = confirmedDraft;
      setDraftState(confirmedDraft);
      baseRef.current = created;
      setBase(created);
      router.setParams({ id: created.id });
    }
  };
  const writeDraftRef = React.useRef(writeDraft);
  writeDraftRef.current = writeDraft;
  const [saveQueue] = React.useState(
    () => new NoteSaveQueue<EditorSaveSnapshot>((next) => writeDraftRef.current(next)),
  );
  React.useEffect(() => () => saveQueue.cancelPending(), [saveQueue]);
  const persist = React.useCallback(
    async (next: LocalNote) => {
      const version = ++saveVersion.current;
      setSaveState('saving');
      try {
        await saveQueue.save({ draft: next, base: baseRef.current });
        if (version === saveVersion.current) setSaveState('saved');
      } catch (error) {
        if (version === saveVersion.current) setSaveState('error');
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
  //
  // On web, expo-router 58's guard also blocks browser refresh/close for as long
  // as it is on. The editor warns on unload only while a draft is at risk (the
  // effect below), so on web the guard is on only while leaving has work to do:
  // a write still pending or failed, or a stored note left empty that leaving
  // deletes. A saved note then leaves with no prompt and no write, as before.
  const leaveHasWork = saveState !== 'saved' || (base !== null && isEmptyNote(draft));
  const disablePrevention = usePreventRemove(
    (isNew || base !== null) && !leaveAllowed && (Platform.OS !== 'web' || leaveHasWork),
    ({ repeat }) => {
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
        if (id && isEmptyNote(next)) {
          await deleteNote.mutateAsync(id);
        }
        setLeaveAllowed(true);
        repeat();
      })()
        .catch(() => {
          setSaveState('error');
        })
        .finally(() => {
          leavingRef.current = false;
        });
    },
  );

  // Browser refresh/close cannot await SQLite. Warn only while a draft is at risk.
  React.useEffect(() => {
    if (Platform.OS !== 'web' || saveState === 'saved') return;
    const protectDraft = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', protectDraft);
    return () => window.removeEventListener('beforeunload', protectDraft);
  }, [saveState]);

  // Apply a draft change locally and schedule a debounced autosave (typing).
  const update = React.useCallback(
    (patch: Partial<LocalNote>) => {
      const next = { ...draftRef.current, ...patch };
      setDraft(next);
      saveVersion.current++;
      setSaveState('unsaved');
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
    void runExport(async (viewerId, isCurrent) => {
      if (viewerId !== editorOwner.current) return;
      const note = draftRef.current;
      // Preserve the visible draft, including edits not yet written to SQLite.
      try {
        await saveTextFile(noteFilename(note), noteToMarkdown(note), 'markdown', isCurrent);
      } catch (error) {
        if (isCurrent()) {
          logger.error('Could not export the note', { error: String(error) });
          toast.error(t('notes.exportFailed'));
        }
      }
    });
  }, [runExport, t]);

  const handleToggleLabel = React.useCallback(
    (labelId: string) => {
      const prev = draftRef.current;
      const has = prev.labels.includes(labelId);
      const nextLabels = has ? prev.labels.filter((l) => l !== labelId) : [...prev.labels, labelId];
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
      screen: 'FileManagement',
      props: {
        selectMode: true,
        multiSelect: true,
        afterSelect: 'back',
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
        attachments: (draftRef.current.attachments ?? []).filter((i) => i !== id),
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
      setLeaveAllowed(true);
      disablePrevention();
      router.back();
    } catch {
      setSaveState('error');
    } finally {
      leavingRef.current = false;
    }
  }, [autosave, persist, trashNote, router, disablePrevention]);

  const mentions = React.useMemo(
    () => noteMentionSource(isNew ? '' : params.id, t('notes.untitledVersion')),
    [isNew, params.id, t],
  );

  const attachmentOpened = React.useRef(false);
  React.useEffect(() => {
    if (params.mode !== 'attachment' || attachmentOpened.current) return;
    attachmentOpened.current = true;
    handleAttachFile();
  }, [params.mode, handleAttachFile]);

  if (!isNew && !isLoading && (loadError || !fetchedNote) && !base) {
    return (
      <View className="flex-1 bg-background">
        <EmptyState
          sticker={loadError ? 'loadError' : 'notFound'}
          title={t(loadError ? 'notes.loadFailed' : 'notes.notFoundTitle')}
          subtitle={t(loadError ? 'notes.loadFailedSubtitle' : 'notes.notFoundSubtitle')}
          action={{
            label: t('common.back'),
            onPress: () => (router.canGoBack() ? router.back() : router.replace('/')),
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
  // Bloom owns the web dialog; native retains its full-screen editor.
  const isWebModal = Platform.OS === 'web';

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
            label={t('common.back')}
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          />
        </View>
        <View className="ml-auto flex-row items-center">
          <IconButton
            icon={draft.pinned ? PinOff : Pin}
            label={draft.pinned ? t('notes.unpin') : t('notes.pin')}
            onPress={() => {
              haptic();
              updateNow({ pinned: !draft.pinned });
            }}
            active={draft.pinned}
          />
          <IconButton
            icon={Bell}
            label={t('notes.reminder')}
            onPress={() => setShowReminders((s) => !s)}
          />
          <IconButton
            icon={draft.archived ? ArchiveRestore : Archive}
            label={draft.archived ? t('notes.unarchive') : t('notes.archive')}
            onPress={() => {
              haptic();
              updateNow({ archived: !draft.archived });
            }}
          />
          <IconButton
            icon={Trash2}
            label={t('common.delete')}
            onPress={() => {
              haptic('medium');
              void handleTrash();
            }}
          />
        </View>
      </View>

      <View
        className="flex-row items-center justify-between px-4 pb-1"
        accessibilityLiveRegion="polite"
      >
        <Text
          className={
            saveState === 'error' ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'
          }
        >
          {t(`notes.saveStatus.${saveState}`)}
        </Text>
        {saveState === 'error' && (
          <Button
            appearance="plain"
            size="sm"
            onPress={() => {
              autosave.cancel();
              void persist(draftRef.current).catch(() => {});
            }}
          >
            {t('common.retry')}
          </Button>
        )}
      </View>

      {/* Reminder presets */}
      {showReminders && (
        <View className="mx-3 mb-1 flex-row flex-wrap gap-2 rounded-xl border border-border bg-card p-2">
          <ReminderChip
            label={t('notes.laterToday')}
            onPress={() => handleSetReminder('laterToday')}
          />
          <ReminderChip label={t('notes.tomorrow')} onPress={() => handleSetReminder('tomorrow')} />
          <ReminderChip label={t('notes.nextWeek')} onPress={() => handleSetReminder('nextWeek')} />
          <ReminderChip
            label={t('notes.customReminder')}
            onPress={() => {
              setShowReminders(false);
              setReminderPickerOpen(true);
            }}
          />
          {draft.reminderAt && (
            <ReminderChip
              label={t('notes.clearReminder')}
              onPress={handleClearReminder}
              destructive
            />
          )}
        </View>
      )}

      <ScrollView
        className="flex-1"
        contentContainerClassName="px-4 pb-4 pt-1"
        keyboardShouldPersistTaps="handled"
        style={
          isLargeScreen && !isWebModal
            ? { maxWidth: 720, width: '100%', alignSelf: 'center' }
            : undefined
        }
      >
        {(draft.attachments?.length ?? 0) > 0 && (
          <View className="mb-3">
            <AttachmentsRow
              attachments={draft.attachments ?? []}
              removed={draft.removedAttachments}
              variant="editor"
              onRemove={handleRemoveAttachment}
            />
          </View>
        )}

        {/* What is happening to this note's recording, read from the capture row
            rather than from anything this screen remembers — so it says the same
            thing after a restart, and offers the same repair. */}
        <CaptureStatusLine noteId={isNew ? '' : params.id} />

        <TextFieldInput
          label={t('notes.titlePlaceholder')}
          value={draft.title}
          onChangeText={(title) => update({ title })}
          placeholder={t('notes.titlePlaceholder')}
          placeholderTextColor={colors.mutedForeground}
          className="py-2 text-xl font-semibold text-foreground"
          multiline
        />

        <NoteBlockEditor
          noteId={draft.id}
          blocks={draft.blocks}
          mentions={mentions}
          onOpenNote={(id) => router.push(`/n/${id}`)}
          onChange={(blocks) => {
            const previous = draftRef.current;
            // The write keeps the screen honest now; the overrides keep it
            // honest after the next finalisation. Without them the next pass
            // rebuilds the artifact, finds no record that anybody touched a
            // generated task, and the tick disappears minutes later.
            void recordChecklistOverrides(
              params.id,
              generatedTodos(previous.blocks, previous.generated),
              generatedTodos(blocks, previous.generated),
            );
            update({ blocks });
          }}
        />

        {draft.labels.length > 0 && <LabelChips labelIds={draft.labels} allLabels={allLabels} />}

        {!isNew && <LinkedMentions noteId={params.id} title={draft.title} />}

        {/* What was actually said, for when the note is not enough. Collapsed by
            default: a note is the handful of things worth reading again, and
            opening the transcript unasked puts the work the app exists to save
            back in front of the reader. */}
        <TranscriptPanel noteId={isNew ? '' : params.id} />

        {/* What this recording was, and what it is still keeping. Both belong on
            the note rather than in settings: both are about THIS recording, and
            burying retention two screens away is how an hour of audio stays on a
            phone forever. */}
        <RecordingControls noteId={isNew ? '' : params.id} />
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
          <IconButton icon={Paperclip} label={t('notes.attachFile')} onPress={handleAttachFile} />
          <IconButton
            icon={Palette}
            label={t('notes.color')}
            onPress={() => setShowColors((s) => !s)}
            active={showColors}
          />
          <IconButton
            icon={Tag}
            label={t('notes.labels')}
            onPress={() => setLabelDialogOpen(true)}
          />
          <IconButton
            icon={FolderInput}
            label={t('folders.move')}
            onPress={() => setFolderOpen(true)}
            active={Boolean(draft.folderId)}
          />
          <IconButton icon={Download} label={t('notes.exportMarkdown')} onPress={handleExport} />
          <IconButton icon={Link2} label={t('notes.linkNote')} onPress={() => setLinkOpen(true)} />
          {!isNew && (
            <IconButton
              icon={History}
              label={t('notes.history')}
              onPress={() => setHistoryOpen(true)}
            />
          )}
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

  const reminderPickerDialog = (
    <ReminderPickerDialog
      open={reminderPickerOpen}
      onOpenChange={setReminderPickerOpen}
      current={draft.reminderAt}
      onPick={(when) => updateNow({ reminderAt: when.toISOString() })}
    />
  );

  const folderDialog = (
    <FolderPickerDialog
      open={folderOpen}
      onOpenChange={setFolderOpen}
      current={draft.folderId ?? null}
      onPick={(folderId) => updateNow({ folderId })}
    />
  );

  const linkDialog = (
    <LinkNoteDialog
      open={linkOpen}
      onOpenChange={setLinkOpen}
      currentId={isNew ? '' : params.id}
      onPick={(note) => {
        // A line linking the note, after everything else; the editor shows it
        // as a mention, and Nilo as a link to that page.
        const blocks = draftRef.current.blocks;
        const last = blocks.filter((block) => block.parentBlockId === null).length;
        update({
          blocks: [
            ...blocks,
            {
              id: newNoteId(),
              parentBlockId: null,
              type: 'paragraph',
              content: linkParagraph(note),
              order: last,
            },
          ],
        });
      }}
    />
  );

  const historyDialog = isNew ? null : (
    <RevisionsDialog
      open={historyOpen}
      onOpenChange={setHistoryOpen}
      noteId={params.id}
      onRestore={(patch) => updateNow({ blocks: renumber(patch.blocks ?? []) })}
    />
  );

  // The route fills its native scene or Bloom dialog with the note tint.
  return (
    <View className="flex-1" style={{ backgroundColor }}>
      {editorContent}
      {labelDialog}
      {folderDialog}
      {reminderPickerDialog}
      {linkDialog}
      {historyDialog}
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
      tone={destructive ? 'danger' : 'neutral'}
      size="sm"
      onPress={onPress}
    >
      {label}
    </Button>
  );
}
