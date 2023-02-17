import { defineStore } from "pinia";
export const useNotesStore = defineStore({
  id: "notes",
  state: () => ({
    notes: [],
    users: [],
  }),
  actions: {
    async fetchNotes() {
      const supabase = useSupabaseClient();
      const { data: notes, error } = await supabase
        .from("notes")
        .select("*")
        .order("id", { ascending: false });
      if (error) {
        console.error(error);
      } else {
        this.notes = notes.map((note) => ({
          id: note.id,
          title: note.title,
          text: note.text,
          color: note.color,
          date: new Date(note.date),
          sharedWith: note.sharedWith || [],
          list: note.list || "",
        }));
      }
    },
    async addNote(newNote) {
      const supabase = useSupabaseClient();
      const { data: note, error } = await supabase
        .from("notes")
        .insert({
          title: newNote.title,
          text: newNote.text,
          color: newNote.color,
          date: new Date(newNote.date),
          list: newNote.list,
        })
        .single();
      if (error) {
        console.error(error);
      } else {
        this.notes.push({
          id: note.id,
          title: note.title,
          text: note.text,
          color: note.color,
          date: new Date(note.date),
          sharedWith: note.sharedWith || [],
          list: note.list || "",
        });
      }
    },
    async updateNote(updatedNote) {
      const supabase = useSupabaseClient();
      const { error } = await supabase
        .from("notes")
        .update({
          title: updatedNote.title,
          text: updatedNote.text,
          color: updatedNote.color,
          date: new Date(updatedNote.date),
          list: updatedNote.list,
        })
        .eq("id", updatedNote.id);
      if (error) {
        console.error(error);
      } else {
        const noteIndex = this.notes.findIndex(
          (note) => note.id === updatedNote.id
        );
        if (noteIndex !== -1) {
          this.notes.splice(noteIndex, 1, {
            id: updatedNote.id,
            title: updatedNote.title,
            text: updatedNote.text,
            color: updatedNote.color,
            date: updatedNote.date,
            sharedWith: updatedNote.sharedWith || [],
            list: updatedNote.list,
          });
        }
      }
    },
    async deleteNote(noteId) {
      const supabase = useSupabaseClient();
      const { error } = await supabase.from("notes").delete().eq("id", noteId);
      if (error) {
        console.error(error);
      } else {
        const noteIndex = this.notes.findIndex((note) => note.id === noteId);
        if (noteIndex !== -1) {
          this.notes.splice(noteIndex, 1);
        }
      }
    },
  },
});
