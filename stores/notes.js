import { defineStore } from "pinia";

export const useNotesStore = defineStore({
  id: "notes",
  state: () => ({
    notes: [
      {
        id: 1,
        title: "My first note",
        text: "This is the text of my first note.",
        color: "#FFFFCC",
        date: new Date("2022-08-22T14:00"),
        sharedWith: [2, 3],
        list: "Item 1\nItem 2\nItem 3",
      },
      {
        id: 2,
        title: "My second note",
        text: "This is the text of my second note.",
        color: "#CCFFFF",
        date: new Date("2022-08-23T10:30"),
        sharedWith: [1],
        list: "Task 1\nTask 2\nTask 3",
      },
    ],
    users: [
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" },
      { id: 3, name: "Charlie" },
    ],
  }),
  actions: {
    addNote(newNote) {
      const nextId = this.notes.length + 1;
      const note = {
        id: nextId,
        ...newNote,
        date: new Date(newNote.date),
      };
      this.notes.push(note);
    },
    updateNote(updatedNote) {
      const noteIndex = this.notes.findIndex(
        (note) => note.id === updatedNote.id
      );
      if (noteIndex !== -1) {
        this.notes[noteIndex] = {
          ...updatedNote,
          date: new Date(updatedNote.date),
        };
      }
    },
    deleteNote(noteId) {
      const noteIndex = this.notes.findIndex((note) => note.id === noteId);
      if (noteIndex !== -1) {
        this.notes.splice(noteIndex, 1);
      }
    },
  },
});
