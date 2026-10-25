/**
 * useNotificationSetup — Push notification registration, foreground handling,
 * tap deep-linking, and real-time Socket.IO notification subscription.
 *
 * Call once in the authenticated app layout.
 */

import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useOxy } from '@oxy.so/services/ui/client';
import { io as socketIO } from 'socket.io-client';
import config from '@/lib/config';
import apiClient from '@/lib/api/client';

// ── Constants ──────────────────────────────────────────────────────
const PROJECT_ID =
  Constants.expoConfig?.extra?.eas?.projectId ?? 'ca1a1ca1-2469-4ceb-8387-e43d6832bbab';

// ── Foreground notification display (native only) ──────────────
// Installed when this module loads, before any screen asks for permission or
// creates a channel: from SDK 58 a notification that arrives with no handler
// installed is shown with Expo's defaults, so the handler has to be the first
// thing in place rather than an effect that runs after its children's.
if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });
}

export function useNotificationSetup() {
  const { user, oxyServices, isAuthenticated, activeSessionId } = useOxy();
  const router = useRouter();
  const queryClient = useQueryClient();
  const tokenRef = useRef<string | null>(null);
  const webPushRegisteredRef = useRef(false);

  // ── Push token registration ────────────────────────────────────
  useEffect(() => {
    if (!isAuthenticated || !user?.id || Platform.OS === 'web') return;

    let cancelled = false;

    (async () => {
      try {
        // Android: create notification channel
        if (Platform.OS === 'android') {
          await Notifications.setNotificationChannelAsync('default', {
            name: 'Default',
            importance: Notifications.AndroidImportance.HIGH,
          });
        }

        // Check / request permission
        const { status: existing } = await Notifications.getPermissionsAsync();
        let finalStatus = existing;
        if (existing !== 'granted') {
          const { status } = await Notifications.requestPermissionsAsync();
          finalStatus = status;
        }
        if (finalStatus !== 'granted' || cancelled) return;

        // Get Expo push token
        const { data: token } = await Notifications.getExpoPushTokenAsync({
          projectId: PROJECT_ID,
        });
        if (cancelled || !token || token === tokenRef.current) return;

        tokenRef.current = token;

        // Register with backend
        // Registered as Noted's, so a note's reminder rings here and not also
        // in Nilo on the same phone.
        await apiClient.post('/notifications/push-token', {
          token,
          platform: Platform.OS,
          app: 'noted',
        });
      } catch {
        // Non-critical — expected to fail in dev without FCM credentials
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, user?.id]);

  // ── Notification tap handler (deep-link to the note) ───────
  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      if (!isAuthenticated) return;
      const data = response.notification.request.content.data;
      // A reminder from Nilo names the note as its page (a note is a Nilo
      // page); one scheduled on this device names it `noteId`.
      const noteId = data?.noteId ?? data?.pageId;
      if (typeof noteId === 'string' && noteId) {
        router.push(`/n/${noteId}`);
      }
    });

    return () => subscription.remove();
  }, [router, isAuthenticated]);

  // ── Web push registration (browser only) ──────────────────────
  useEffect(() => {
    if (Platform.OS !== 'web' || !isAuthenticated || !user?.id) return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    if (webPushRegisteredRef.current) return;

    let cancelled = false;

    (async () => {
      try {
        // Fetch VAPID public key from backend
        const { data: vapidData } = await apiClient.get<{ publicKey?: string }>(
          '/notifications/vapid-public-key',
        );
        if (cancelled || !vapidData?.publicKey) return;

        // Register service worker
        const registration = await navigator.serviceWorker.register('/sw.js');
        await navigator.serviceWorker.ready;

        // Check for existing subscription
        let subscription = await registration.pushManager.getSubscription();

        if (!subscription) {
          // Request permission
          const permission = await Notification.requestPermission();
          if (cancelled || permission !== 'granted') return;

          // Convert VAPID key from base64url to Uint8Array
          const vapidKey = urlBase64ToUint8Array(vapidData.publicKey);

          // Subscribe
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: vapidKey,
          });
        }

        if (cancelled || !subscription) return;

        // Send subscription to backend
        const subJson = subscription.toJSON();
        await apiClient.post('/notifications/web-push-subscription', {
          endpoint: subJson.endpoint,
          keys: subJson.keys,
          app: 'noted',
        });

        if (!cancelled) webPushRegisteredRef.current = true;
      } catch {
        // Non-critical — web push not available in all browsers/contexts
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, user?.id]);

  // ── Socket.IO real-time notification subscription ──────────────
  useEffect(() => {
    if (!isAuthenticated || !user?.id || !activeSessionId) return;
    const linked = oxyServices.createLinkedClient({ baseURL: config.apiUrl });
    const handshake = new AbortController();
    const epoch = oxyServices.http.getSessionEpoch();
    const current = () => !handshake.signal.aborted && oxyServices.http.getSessionEpoch() === epoch;

    const socket = socketIO(config.apiUrl, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      auth: (callback) => {
        void linked.getAccessToken(config.apiUrl, { signal: handshake.signal }).then(
          (token) => {
            if (current()) callback({ token });
          },
          () => {
            // Surface an authentication failure without sending a stale bearer.
            if (current()) callback({});
          },
        );
      },
    });

    const unsubscribe = oxyServices.http.addTokenChangeListener(() => {
      if (oxyServices.http.getSessionEpoch() === epoch) return;
      handshake.abort();
      socket.disconnect();
    });

    socket.on('notification', () => {
      if (!current()) return;
      // Invalidate React Query caches so notification list + unread count refresh
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    });

    return () => {
      handshake.abort();
      unsubscribe();
      linked.dispose();
      socket.disconnect();
    };
  }, [isAuthenticated, user?.id, activeSessionId, oxyServices, queryClient]);
}

// ── Helpers ──────────────────────────────────────────────────────

/** Convert a base64url-encoded VAPID key to a Uint8Array for PushManager.subscribe */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const output = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; ++i) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}
