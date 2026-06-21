import type { NoteListParams } from "@/lib/types/note";

export const queryKeys = {
  notes: {
    all: ["notes"] as const,
    /** A filtered list of notes (home, archive, trash, label-filtered, search). */
    list: (params: NoteListParams) => ["notes", "list", params] as const,
    detail: (id: string) => ["notes", "detail", id] as const,
  },
  labels: {
    all: ["labels"] as const,
  },
} as const;
