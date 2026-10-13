import { useMemo } from 'react';
import { useLiveQuery } from '@/lib/db/live-query';
import { backlinksQuery, rowsToNotes, type LocalNote, type NoteRow } from '@/lib/db/notes-repo';

const NONE: LocalNote[] = [];

/** Notes that link to this one with `[[its title]]`, read from the local store. */
export function useBacklinks(target: { id: string; title: string } | null) {
  const id = target?.id ?? '';
  const title = target?.title ?? '';
  const query = useMemo(() => backlinksQuery({ id, title }), [id, title]);
  const { data } = useLiveQuery<NoteRow, LocalNote[]>({
    sql: query.sql,
    params: query.params,
    mapRows: rowsToNotes,
  });
  return target ? (data ?? NONE) : NONE;
}
