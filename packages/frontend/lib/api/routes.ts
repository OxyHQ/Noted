/**
 * The API's routes, in one place.
 *
 * Noted's server is Nilo: its notes are rows of the personal workspace's
 * notes database, served by Nilo's `/notes` (contract:
 * `@oxy.so/nilo-contracts` `notes.ts`). A note's history is its Nilo page's.
 */

export const API_ROUTES = {
  // Notes
  notes: {
    revisions: (id: string) => `/pages/${id}/versions`,
    revision: (id: string, revisionId: string) => `/pages/${id}/versions/${revisionId}`,
    list: '/notes',
    create: '/notes',
    get: (id: string) => `/notes/${id}`,
    update: (id: string) => `/notes/${id}`,
    delete: (id: string) => `/notes/${id}`,
    reorder: '/notes/reorder',
    /** Everything changed since a cursor, deletions included. */
    sync: '/notes/sync',
  },

  // The caller's whole Noted account: their notes, labels and folders
  account: {
    export: '/notes/export',
    erase: '/notes/erase',
  },

  // Folders
  folders: {
    list: '/notes/folders',
    create: '/notes/folders',
    update: (id: string) => `/notes/folders/${id}`,
    delete: (id: string) => `/notes/folders/${id}`,
  },

  // Labels
  labels: {
    list: '/notes/labels',
    create: '/notes/labels',
    update: (id: string) => `/notes/labels/${id}`,
    delete: (id: string) => `/notes/labels/${id}`,
  },

  // Notifications
  notifications: {
    list: '/notifications',
    pushToken: '/notifications/push-token',
    vapidPublicKey: '/notifications/vapid-public-key',
    webPushSubscription: '/notifications/web-push-subscription',
  },

  // Health check
  health: '/health/live',
} as const;
