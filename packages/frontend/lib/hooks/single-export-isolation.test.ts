import React from 'react';
import { createRequire } from 'node:module';
import { OxyServices } from '@oxy.so/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { create, act } = createRequire(import.meta.url)('react-test-renderer');
const fixture = vi.hoisted(() => ({
  viewer: 'A',
  oxy: null as unknown as OxyServices,
  auth: {
    isAuthenticated: true,
    user: { id: 'A' },
    activeSessionId: 'session-A',
    oxyServices: null as unknown as OxyServices,
    showBottomSheet: vi.fn(),
  },
  note: {
    id: 'same-note',
    kind: 'note',
    title: 'A original',
    blocks: [],
    generated: {},
    color: 'default',
    labels: [],
    pinned: false,
    archived: false,
    trashed: false,
    attachments: [],
    removedAttachments: [],
    reminderAt: null,
    order: 0,
    folderId: null,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  },
  write: vi.fn(),
  available: vi.fn(),
  share: vi.fn(),
  toast: vi.fn(),
}));
vi.mock('@oxy.so/services/ui/client', () => ({ useOxy: () => fixture.auth }));
vi.mock('@/lib/oxy', () => ({
  get oxyServices() {
    return fixture.oxy;
  },
}));
vi.mock('@/lib/db/client', () => ({ getActiveViewerId: () => fixture.viewer }));
vi.mock('@/lib/db/local-store-context', () => ({
  useLocalStoreState: () => ({ isReady: true, viewerId: fixture.viewer, error: null }),
}));
vi.mock('react-native', () => ({
  View: 'View',
  ScrollView: 'ScrollView',
  ActivityIndicator: 'ActivityIndicator',
  useWindowDimensions: () => ({ width: 400 }),
  Platform: { OS: 'ios' },
}));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));
vi.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'same-note' }),
  useRouter: () => ({
    canGoBack: () => true,
    back: vi.fn(),
    replace: vi.fn(),
    push: vi.fn(),
    setParams: vi.fn(),
  }),
  usePreventRemove: () => () => {},
}));
vi.mock('@oxy.so/bloom/button', async () => {
  const { createElement } = await import('react');
  return {
    Button: 'Button',
    GlyphButton: ({ children: _children, ...props }: Record<string, unknown>) =>
      createElement('glyph', props),
  };
});
vi.mock('@oxy.so/bloom/dialog', () => ({ Dialog: 'Dialog' }));
vi.mock('@oxy.so/bloom/page-header', () => ({ PageHeader: 'PageHeader' }));
vi.mock('@oxy.so/bloom/screen', () => ({ Screen: 'Screen' }));
vi.mock('@oxy.so/bloom/text-field', () => ({ TextFieldInput: 'TextFieldInput' }));
vi.mock('@oxy.so/bloom/toast', () => ({
  toast: { error: (...args: unknown[]) => fixture.toast(...args) },
}));
vi.mock('@oxy.so/bloom/hooks', () => ({ useHaptics: () => () => {} }));
vi.mock('lucide-react-native', () =>
  Object.fromEntries(
    'ArrowLeft Pin PinOff Archive ArchiveRestore Trash2 Palette Tag Paperclip Bell Download FolderInput History Link2'
      .split(' ')
      .map((name) => [name, () => null]),
  ),
);
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/lib/useColorScheme', () => ({
  useColorScheme: () => ({ colors: { background: 'white' }, colorScheme: 'light' }),
}));
vi.mock('@/lib/note-colors', () => ({ getNoteColorTint: () => null }));
vi.mock('@/lib/hooks/use-labels', () => ({ useLabels: () => ({ data: [] }) }));
vi.mock('@/lib/hooks/use-notes', () => ({
  useNote: () => ({ data: fixture.note, isLoading: false, error: null }),
  useCreateNote: () => ({ mutateAsync: vi.fn() }),
  useUpdateNote: () => ({ mutateAsync: vi.fn() }),
  useTrashNote: () => ({ mutateAsync: vi.fn() }),
  useDeleteNote: () => ({ mutateAsync: vi.fn() }),
  makeDraftNote: () => ({ ...fixture.note }),
}));
vi.mock('@/lib/shared-storage', () => ({ scopedAttachmentSelection: () => vi.fn() }));
vi.mock('@/lib/artifact/record-checklist', () => ({ recordChecklistOverrides: vi.fn() }));
vi.mock('@/lib/notes/mention-source', () => ({
  linkParagraph: vi.fn(),
  noteMentionSource: () => [],
}));
vi.mock('@/lib/db/ids', () => ({ newNoteId: () => 'new-id' }));
vi.mock('@/components/ui/text', () => ({ Text: 'Text' }));
vi.mock('@/components/empty-state', () => ({ EmptyState: () => null }));
vi.mock('@/components/floating-bottom-stack', () => ({ FloatingBottomStack: () => null }));
vi.mock('@/components/notes/note-color-picker', () => ({ NoteColorPicker: () => null }));
vi.mock('@/components/capture/capture-status', () => ({ CaptureStatusLine: () => null }));
vi.mock('@/components/capture/transcript-panel', () => ({ TranscriptPanel: () => null }));
vi.mock('@/components/capture/recording-controls', () => ({ RecordingControls: () => null }));
vi.mock('@/components/notes/note-block-editor', () => ({ NoteBlockEditor: () => null }));
vi.mock('@/components/notes/label-chips', () => ({ LabelChips: () => null }));
vi.mock('@/components/notes/label-assign-dialog', () => ({ LabelAssignDialog: () => null }));
vi.mock('@/components/notes/folder-picker-dialog', () => ({ FolderPickerDialog: () => null }));
vi.mock('@/components/notes/linked-mentions', () => ({ LinkedMentions: () => null }));
vi.mock('@/components/notes/link-note-dialog', () => ({ LinkNoteDialog: () => null }));
vi.mock('@/components/notes/reminder-picker-dialog', () => ({ ReminderPickerDialog: () => null }));
vi.mock('@/components/notes/revisions-dialog', () => ({ RevisionsDialog: () => null }));
vi.mock('@/components/notes/attachments/AttachmentsRow', () => ({ AttachmentsRow: () => null }));
vi.mock('expo-file-system', () => ({
  Paths: { cache: 'cache' },
  Directory: class {
    create() {}
  },
  File: class {
    uri = 'file:///synthetic';
    exists = false;
    create() {}
    delete() {}
    write(data: unknown) {
      return fixture.write(data);
    }
  },
}));
vi.mock('expo-sharing', () => ({
  isAvailableAsync: () => fixture.available(),
  shareAsync: (...args: unknown[]) => fixture.share(...args),
}));
vi.mock('@/lib/export/save', async () => await import('@/lib/export/save.native'));
import NoteEditorScreen from '@/app/n/[id]';

let root: ReturnType<typeof create>;
let oxy: OxyServices;
function pressExport() {
  return root.root.findByProps({ accessibilityLabel: 'notes.exportMarkdown' }).props
    .onPress as () => void;
}
async function switchAccount(viewer: string) {
  fixture.viewer = viewer;
  fixture.auth.user = { id: viewer };
  fixture.auth.activeSessionId = `session-${viewer}`;
  fixture.note = { ...fixture.note, title: `${viewer} original` };
  await act(async () => root.update(React.createElement(NoteEditorScreen)));
}
beforeEach(async () => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.viewer = 'A';
  fixture.note = { ...fixture.note, title: 'A original' };
  oxy = new OxyServices({ baseURL: 'https://noted.example' });
  fixture.oxy = oxy;
  fixture.auth = {
    isAuthenticated: true,
    user: { id: 'A' },
    activeSessionId: 'session-A',
    oxyServices: oxy,
    showBottomSheet: vi.fn(),
  };
  fixture.write.mockReset().mockResolvedValue(undefined);
  fixture.available.mockReset().mockResolvedValue(true);
  fixture.share.mockReset().mockResolvedValue(undefined);
  fixture.toast.mockReset();
  await act(async () => {
    root = create(React.createElement(NoteEditorScreen));
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  oxy.dispose();
});
describe('single-note export', () => {
  it('exports the visible unsaved draft with a restored tokenless local session', async () => {
    await act(async () =>
      root.root.findByType('TextFieldInput').props.onChangeText('A edited offline'),
    );
    await act(async () => {
      pressExport()();
      await Promise.resolve();
    });
    expect(fixture.write).toHaveBeenCalledWith('# A edited offline');
    expect(fixture.share).toHaveBeenCalledOnce();
  });
  it('does not run a retained A callback after the editor remounts for B', async () => {
    const retained = pressExport();
    await switchAccount('B');
    await act(async () => {
      retained();
      await Promise.resolve();
    });
    expect(fixture.write).not.toHaveBeenCalled();
    expect(fixture.share).not.toHaveBeenCalled();
  });
  it('does not write the old note when the account changes during share availability', async () => {
    let release!: (result: boolean) => void;
    fixture.available.mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        release = resolve;
      }),
    );
    await act(async () => {
      pressExport()();
      await Promise.resolve();
    });
    await switchAccount('B');
    await act(async () => {
      release(true);
      await Promise.resolve();
    });
    expect(fixture.write).not.toHaveBeenCalled();
    expect(fixture.share).not.toHaveBeenCalled();
  });
});
