/**
 * Centralized API routes configuration.
 * All Noted API endpoints are defined here for easy maintenance.
 */

export const API_ROUTES = {
  // Notes
  notes: {
    list: "/notes",
    create: "/notes",
    get: (id: string) => `/notes/${id}`,
    update: (id: string) => `/notes/${id}`,
    delete: (id: string) => `/notes/${id}`,
    trash: (id: string) => `/notes/${id}/trash`,
    restore: (id: string) => `/notes/${id}/restore`,
    reorder: "/notes/reorder",
  },

  // Labels
  labels: {
    list: "/labels",
    create: "/labels",
    update: (id: string) => `/labels/${id}`,
    delete: (id: string) => `/labels/${id}`,
  },

  // Notifications
  notifications: {
    list: "/notifications",
    pushToken: "/notifications/push-token",
    vapidPublicKey: "/notifications/vapid-public-key",
    webPushSubscription: "/notifications/web-push-subscription",
  },

  // Health check
  health: "/health",
} as const;
