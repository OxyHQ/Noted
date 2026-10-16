/**
 * A note's content, edited as blocks with Bloom's editor — the one Nilo uses,
 * native on every platform.
 *
 * The editor holds its own document (a text input cannot be re-rendered from
 * props on every keystroke and keep its caret), and this component keeps it
 * and the screen's `blocks` in step both ways:
 *
 * - every local edit (typing, undo) is flattened and handed up (`onChange`);
 * - `blocks` arriving different from what was last handed up — the recorder's
 *   rebuild, another device's edit merged in by the screen — are applied to
 *   the editor as one remote transaction (`documentOperations`), which leaves
 *   the caret and the undo history alone. Resetting the editor would not.
 */
import {
  BlockEditor,
  EditorStore,
  EditorToolbar,
  type MentionSource,
  useEditorController,
} from '@oxy.so/bloom-editor';
import type { MentionMark } from '@oxy.so/bloom-text/model';
import React from 'react';
import { Platform, View } from 'react-native';

import {
  useEditorLabels,
  useEditorTheme,
  useSlashItems,
} from '@/components/notes/editor-presentation';
import { newNoteId } from '@/lib/db/ids';
import { documentOperations, NOTE_SCHEMA, toBlocks, toDocument } from '@/lib/editor/document';
import { KeyboardStickyView } from '@/lib/keyboard';
import type { NoteBlock } from '@/lib/notes/blocks';

export interface NoteBlockEditorProps {
  /** Remounts the editor for another note: its document and history are that note's. */
  noteId: string;
  blocks: readonly NoteBlock[];
  onChange: (blocks: NoteBlock[]) => void;
  /** `@` links another note: a page mention, which Nilo shows as a link to that page. */
  mentions?: MentionSource;
  onOpenNote?: (noteId: string) => void;
  readOnly?: boolean;
}

/** An empty note still has a line to type on. */
function initialBlocks(blocks: readonly NoteBlock[]): readonly NoteBlock[] {
  return blocks.length > 0
    ? blocks
    : [
        {
          id: newNoteId(),
          parentBlockId: null,
          type: 'paragraph',
          content: { text: '' },
          order: 0,
        },
      ];
}

const hasOnlyEmptyLines = (blocks: readonly NoteBlock[]) =>
  blocks.every((block) => block.type === 'paragraph' && !block.content.text);

export function NoteBlockEditor(props: NoteBlockEditorProps) {
  // Keyed: a store and its history belong to one note.
  return <NoteBlockEditorFor key={props.noteId} {...props} />;
}

function NoteBlockEditorFor({
  blocks,
  onChange,
  mentions,
  onOpenNote,
  readOnly,
}: NoteBlockEditorProps) {
  const [store] = React.useState(
    () =>
      new EditorStore({
        document: toDocument(initialBlocks(blocks)),
        schema: NOTE_SCHEMA,
        newId: newNoteId,
      }),
  );
  const controller = useEditorController(store);
  const theme = useEditorTheme();
  const labels = useEditorLabels();
  const slashItems = useSlashItems();

  // What the editor and the screen last agreed the blocks are.
  const agreed = React.useRef(JSON.stringify(blocks));
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;

  React.useEffect(
    () =>
      store.onTransaction((_tx, origin) => {
        if (origin === 'remote') return;
        const next = toBlocks(store.doc);
        agreed.current = JSON.stringify(next);
        onChangeRef.current(next);
      }),
    [store],
  );

  React.useEffect(() => {
    const key = JSON.stringify(blocks);
    if (key === agreed.current) return;
    agreed.current = key;
    // A note with nothing in it yet arrives as no blocks; the editor's empty
    // line is not a difference worth undoing.
    if (blocks.length === 0 && hasOnlyEmptyLines(toBlocks(store.doc))) return;
    const ops = documentOperations(store.doc, toDocument(initialBlocks(blocks)));
    if (ops.length > 0) store.dispatch({ ops }, 'remote');
  }, [blocks, store]);

  const openMention = React.useCallback(
    (mention: MentionMark) => {
      const id = mention.attributes.id;
      if (mention.attributes.kind === 'page' && id) onOpenNote?.(id);
    },
    [onOpenNote],
  );

  return (
    <View>
      <BlockEditor
        store={store}
        controller={controller}
        slashItems={slashItems}
        mentions={mentions}
        onOpenMention={openMention}
        theme={theme}
        labels={labels}
        readOnly={readOnly}
      />
      {Platform.OS !== 'web' && !readOnly ? (
        <KeyboardStickyView offset={{ opened: 0, closed: 0 }}>
          <EditorToolbar
            controller={controller}
            theme={theme}
            labels={labels}
            mentionIndicator={mentions ? '@' : undefined}
          />
        </KeyboardStickyView>
      ) : null}
    </View>
  );
}
