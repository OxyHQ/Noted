import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useOxy } from '@oxy.so/services';
import apiClient from '../api/client';

export interface Notification {
  _id: string;
  type: string;
  title: string;
  body: string;
  status: 'pending' | 'sent' | 'read' | 'dismissed';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  data?: Record<string, unknown>;
  triggerId?: string;
  noteId?: string;
  createdAt: string;
  readAt?: string;
}

interface NotificationsResponse {
  notifications: Notification[];
  total: number;
  unreadCount: number;
}

export function useNotifications(limit = 30) {
  const { isAuthenticated, user } = useOxy();
  const viewerId = isAuthenticated ? user?.id : undefined;

  return useQuery<NotificationsResponse>({
    queryKey: ['notifications', viewerId, 'list', limit],
    queryFn: async () => {
      const res = await apiClient.get<NotificationsResponse>('/notifications', { params: { limit } });
      return res.data;
    },
    staleTime: 1000 * 30, // 30 seconds
    refetchInterval: 1000 * 60, // Refresh every minute
    retry: 2,
    enabled: Boolean(viewerId),
  });
}

export function useUnreadCount() {
  const { isAuthenticated, user } = useOxy();
  const viewerId = isAuthenticated ? user?.id : undefined;

  return useQuery<{ count: number }>({
    queryKey: ['notifications', viewerId, 'unread-count'],
    queryFn: async () => {
      const res = await apiClient.get<{ count: number }>('/notifications/unread-count');
      return res.data;
    },
    staleTime: 1000 * 60 * 5, // 5 minutes — socket invalidates on real events
    refetchInterval: false, // rely on socket-driven invalidation
    retry: 1,
    enabled: Boolean(viewerId),
  });
}

export function useMarkAsRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (notificationId: string) => {
      const res = await apiClient.patch(`/notifications/${notificationId}/read`);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

export function useMarkAllAsRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const res = await apiClient.post('/notifications/read-all');
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

export function useDismissNotification() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (notificationId: string) => {
      const res = await apiClient.patch(`/notifications/${notificationId}/dismiss`);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}
