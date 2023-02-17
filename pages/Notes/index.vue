<template>
    <div class="p-4">
        <div class="flex items-center justify-between">
            <h1 class="text-2xl font-bold">{{ $t('myNotes') }}</h1>
            <button @click="createNote"
                class="rounded-full px-4 py-2 bg-blue-500 text-white shadow hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50">{{
                    $t('createNote') }}</button>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mt-4">
            <div v-for="note in notes" :key="note.id" :class="`bg-accent-${note.color}`" class="w-full h-64 flex flex-col justify-between dark:border-gray-700 rounded-lg
                                                            border border-gray-400 py-5 px-4">
                <div>
                    <h3 class="text-gray-800 dark:text-gray-100 leading-7 font-semibold w-11/12">{{ note.title }}</h3>
                    <p class="text-gray-800 dark:text-gray-100 text-sm">{{ note.text }}</p>
                </div>
                <div>
                    <div class="mb-1 flex items-center flex-no-wrap" v-if="note.sharedWith.length > 0">
                        <div class="w-6 h-6 bg-cover bg-center rounded-md" v-for="(person, index) in note.sharedWith"
                            :class="{ '-ml-2': index > 0 }">
                            <img src="https://tuk-cdn.s3.amazonaws.com/assets/components/avatars/a_4_0.png"
                                alt="read by Alia"
                                class="h-full w-full overflow-hidden object-cover rounded-full border-2 border-white dark:border-gray-700 shadow" />
                        </div>
                    </div>
                    <div class="flex items-center justify-between text-gray-800">
                        <p v-if="note.date.length" class="dark:text-gray-100 text-sm">{{ formatDate(note.date) }}</p>
                        <button
                            class="w-8 h-8 rounded-full dark:bg-gray-100 dark:text-gray-800 bg-gray-800 text-white flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-offset-2  focus:ring-black"
                            @click="editNote(note)">
                            <Icon name="material-symbols:edit" />
                        </button>
                        <button
                            class="w-8 h-8 rounded-full dark:bg-gray-100 dark:text-gray-800 bg-gray-800 text-white flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-offset-2  focus:ring-black"
                            @click="deleteNote(note)">
                            <Icon name="material-symbols:delete" />
                        </button>
                    </div>
                </div>
            </div>
        </div>
        <div v-if="showCreateNoteForm" class="mt-4">
            <h2 class="text-xl font-bold mb-2">Create Note</h2>
            <form @submit.prevent="submitNote">
                <div class="mb-4">
                    <label class="block text-gray-700 font-bold mb-2 dark:text-white" for="title">Title</label>
                    <input v-model="newNote.title"
                        class="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline dark:bg-gray-700 dark:text-white"
                        id="title" type="text" placeholder="Title" required>
                </div>
                <div class="mb-4">
                    <label class="block text-gray-700 font-bold mb-2 dark:text-white" for="text">Text</label>
                    <textarea v-model="newNote.text"
                        class="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline dark:bg-gray-700 dark:text-white"
                        id="text" placeholder="Text" required></textarea>
                </div>
                <div class="mb-4">
                    <label class="block text-gray-700 font-bold mb-2 dark:text-white" for="color">Color</label>
                    <select v-model="newNote.color" id="color" class="h-10 w-full dark:bg-gray-700 dark:text-white">
                        <option v-for="color in ['blue', 'orange', 'green', 'yellow', 'purple', 'pink']" :value="color">
                            {{ color }}
                        </option>
                    </select>
                </div>
                <div class="mb-4">
                    <label class="block text-gray-700 font-bold mb-2 dark:text-white" for="date">Date</label>
                    <input v-model="selectedNote.date" id="date" type="datetime-local"
                        class="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline dark:bg-gray-700 dark:text-white">
                </div>
                <div class="mb-4">
                    <label class="block text-gray-700 font-bold mb-2 dark:text-white" for="sharedWith">Shared With</label>
                    <select va-if="users" v-model="newNote.sharedWith" id="sharedWith" multiple
                        class="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline dark:bg-gray-700 dark:text-white">
                        <option v-for="user in users" :value="user.id">{{ user.name }}</option>
                    </select>
                </div>
                <div class="mb-4">
                    <label class="block text-gray-700 font-bold mb-2 dark:text-white" for="list">List</label>
                    <textarea v-model="newNote.list"
                        class="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline dark:bg-gray-700 dark:text-white"
                        id="list" placeholder="List"></textarea>
                </div>
                <div class="flex items-center justify-end">
                    <button type="submit"
                        class="px-4 py-2 bg-blue-500 text-white rounded-md shadow hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50">Create
                        Note</button>
                    <button type="button" @click="cancelCreateNote"
                        class="px-4 py-2 ml-4 bg-gray-400 text-white rounded-md shadow hover:bg-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-opacity-50 dark:bg-gray-700 dark:text-white">Cancel</button>
                </div>

            </form>
        </div>
        <div v-if="showEditNoteForm" class="mt-4">
            <h2 class="text-xl font-bold mb-2">Edit Note</h2>
            <form @submit.prevent="updateNote">
                <div class="mb-4">
                    <label class="block text-gray-700 font-bold mb-2" for="title">Title</label>
                    <input v-model="selectedNote.title"
                        class="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                        id="title" type="text" placeholder="Title" required>
                </div>
                <div class="mb-4">
                    <label class="block text-gray-700 font-bold mb-2" for="text">Text</label>
                    <textarea v-model="selectedNote.text"
                        class="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                        id="text" placeholder="Text" required></textarea>
                </div>
                <div class="mb-4">
                    <label class="block text-gray-700 font-bold mb-2" for="color">Color</label>
                    <select v-model="selectedNote.color" type="color" id="color" class="h-10 w-full">
                        <option v-for="color in ['blue', 'orange', 'green', 'yellow', 'purple', 'pink']" :value="color">
                            {{ color }}
                        </option>
                    </select>
                </div>
                <div class="mb-4">
                    <label class="block text-gray-700 font-bold mb-2" for="date">Date</label>
                    <input v-model="selectedNote.date" id="date" type="datetime-local"
                        class="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline">
                </div>
                <div class="mb-4">
                    <label class="block text-gray-700 font-bold mb-2" for="sharedWith">Shared With</label>
                    <select v-model="selectedNote.sharedWith" id="sharedWith" multiple
                        class="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline">
                        <option v-for="user in users" :value="user.id">{{ user.name }}</option>
                    </select>
                </div>
                <div class="mb-4">
                    <label class="block text-gray-700 font-bold mb-2" for="list">List</label>
                    <textarea v-model="selectedNote.list"
                        class="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                        id="list" placeholder="List"></textarea>
                </div>
                <div class="flex items-center justify-end">
                    <button type="submit"
                        class="px-4 py-2 bg-green-500 text-white rounded-md shadow hover:bg-green-600 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-opacity-50">Update
                        Note</button>
                    <button type="button" @click="cancelEditNote"
                        class="px-4 py-2 ml-4 bg-gray-400 text-white rounded-md shadow hover:bg-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-opacity-50">Cancel</button>
                </div>
            </form>
        </div>
        <section v-if="!notes.length && !showCreateNoteForm && !showEditNoteForm" class="justify-center flex flex-col">
            <div class="m-auto flex justify-center p-8">
                <div class="w-full max-w-sm">
                    <div class="flex flex-col items-center gap-6">
                        <figure style="width: 336px;">
                            <span
                                style="box-sizing: border-box; display: block; overflow: hidden; width: initial; height: initial; background: none; opacity: 1; border: 0px; margin: 0px; padding: 0px; position: relative;">
                                <span
                                    style="box-sizing: border-box; display: block; width: initial; height: initial; background: none; opacity: 1; border: 0px; margin: 0px; padding: 50% 0px 0px;"></span>
                                <img alt="No bookmarks" src="~/assets/images/emptyPages/Bookmarks.png" decoding="async"
                                    data-nimg="responsive" class="object-cover" sizes="100vw"
                                    style="position: absolute; inset: 0px; box-sizing: border-box; padding: 0px; border: none; margin: auto; display: block; width: 0px; height: 0px; min-width: 100%; max-width: 100%; min-height: 100%; max-height: 100%;">
                            </span>
                        </figure>
                        <div class="flex flex-col gap-2 text-center">
                            <p class="text-3xl font-extrabold">{{ $t('notesEmptyTitle') }}</p>
                            <p class="text-light-secondary dark:text-dark-secondary">{{ $t('notesEmptyDescription') }}
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </section>
</div>
</template>

<script setup>
const notesStore = useNotesStore()

notesStore.fetchNotes();
setInterval(() => {
    notesStore.fetchNotes();
}, 500);

const showCreateNoteForm = ref(false)
const showEditNoteForm = ref(false)
const newNote = reactive({
    title: null,
    text: null,
    color: null,
    date: null,
    sharedWith: [],
    list: null
})
const selectedNote = reactive({
    id: null,
    title: null,
    text: null,
    color: null,
    date: null,
    sharedWith: [],
    list: null
})

const createNote = () => {
    showCreateNoteForm.value = true
}

const cancelCreateNote = () => {
    showCreateNoteForm.value = false
    clearNewNote()
}

const clearNewNote = () => {
    newNote.title = null
    newNote.text = null
    newNote.color = null
    newNote.date = null
    newNote.sharedWith = []
    newNote.list = null
}

const submitNote = () => {
    notesStore.fetchNotes(newNote)
    notesStore.addNote(newNote)
    showCreateNoteForm.value = false
    clearNewNote()
}

const editNote = (note) => {
    selectedNote.id = note.id
    selectedNote.title = note.title
    selectedNote.text = note.text
    selectedNote.color = note.color
    selectedNote.date = note.date
    selectedNote.sharedWith = note.sharedWith
    selectedNote.list = note.list
    showEditNoteForm.value = true
}

const cancelEditNote = () => {
    selectedNote.id = null
    selectedNote.title = null
    selectedNote.text = null
    selectedNote.color = null
    selectedNote.date = null
    selectedNote.sharedWith = []
    selectedNote.list = null
    showEditNoteForm.value = false
}

const updateNote = () => {
    notesStore.updateNote(selectedNote)
    selectedNote.id = null
    selectedNote.title = null
    selectedNote.text = null
    selectedNote.color = null
    selectedNote.date = null
    selectedNote.sharedWith = []
    selectedNote.list = null
    showEditNoteForm.value = false
}

const deleteNote = (note) => {
    notesStore.deleteNote(note.id)
}

const formatDate = (dateString) => {
    const date = new Date(dateString)
    return `${date.toLocaleDateString()} at ${date.toLocaleTimeString()}`
}

const notes = computed(() => {
    return notesStore.notes
})

const users = computed(() => {
    return notesStore.users
})
</script>