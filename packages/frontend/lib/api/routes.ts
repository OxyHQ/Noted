/**
 * Centralized API routes configuration.
 * All Noted API endpoints are defined here for easy maintenance.
 */

export const API_ROUTES = {
  // Notes
  notes: {
    revisions: (id: string) => `/notes/${id}/revisions`,
    revision: (id: string, revisionId: string) => `/notes/${id}/revisions/${revisionId}`,
    list: '/notes',
    create: '/notes',
    get: (id: string) => `/notes/${id}`,
    update: (id: string) => `/notes/${id}`,
    delete: (id: string) => `/notes/${id}`,
    trash: (id: string) => `/notes/${id}/trash`,
    restore: (id: string) => `/notes/${id}/restore`,
    reorder: '/notes/reorder',
    /** Everything changed since a cursor, tombstones included. */
    sync: '/notes/sync',
  },

  // The caller's whole Noted account
  account: {
    export: '/account/export',
    erase: '/account/erase',
  },

  // Folders
  folders: {
    list: '/folders',
    create: '/folders',
    update: (id: string) => `/folders/${id}`,
    delete: (id: string) => `/folders/${id}`,
  },

  // Labels
  labels: {
    list: '/labels',
    create: '/labels',
    update: (id: string) => `/labels/${id}`,
    delete: (id: string) => `/labels/${id}`,
  },

  // Notifications
  notifications: {
    list: '/notifications',
    pushToken: '/notifications/push-token',
    vapidPublicKey: '/notifications/vapid-public-key',
    webPushSubscription: '/notifications/web-push-subscription',
  },

  // Health check
  health: '/health',
} as const;
