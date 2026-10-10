import { PageHeader } from "@oxy.so/bloom/page-header";
import { AppShellMenuButton } from "@oxy.so/bloom/app-shell";
import { Button } from "@oxy.so/bloom/button";
import { ButtonGroup } from "@oxy.so/bloom/button-group";
import { RiNotification3Line } from "@oxy.so/bloom/icons/RiNotification3Line";
import { RiCheckDoubleLine } from "@oxy.so/bloom/icons/RiCheckDoubleLine";
import { EmptyState } from "@/components/empty-state";
import { View, ScrollView, Pressable, Platform } from "react-native";
import { Switch } from "@/components/ui/switch";
import { Text } from "@/components/ui/text";
import { useRouter } from "expo-router";
import { Bell, BellOff, Zap, Clock, Eye, AlertTriangle, MessageSquare, X } from "lucide-react-native";
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@oxy.so/services";
import * as ExpoNotifications from "expo-notifications";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";

import { useTranslation } from "@/hooks/useTranslation";
import {
  useNotifications,
  useMarkAsRead,
  useMarkAllAsRead,
  useDismissNotification,
  type Notification,
} from "@/lib/hooks/use-notifications";

const TYPE_ICONS: Record<string, typeof Zap> = {
  trigger_result: Zap,
  proactive_insight: Eye,
  daily_briefing: Clock,
  price_alert: AlertTriangle,
  reminder: Bell,
  chat_response_ready: MessageSquare,
  agent_task_complete: Zap,
};

const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'border-l-red-500',
  high: 'border-l-orange-400',
  normal: 'border-l-blue-400',
  low: 'border-l-muted-foreground',
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function NotificationsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { isAuthenticated } = useAuth();

  const [pushEnabled, setPushEnabled] = useState(false);
  const [permissionStatus, setPermissionStatus] = useState<string | null>(null);
  const [pushLoading, setPushLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(false);

  const { data, isLoading, isError, refetch } = useNotifications();
  const markAsRead = useMarkAsRead();
  const markAllAsRead = useMarkAllAsRead();
  const dismiss = useDismissNotification();

  useEffect(() => {
    if (!isAuthenticated) {
      router.replace("/(app)");
    }
  }, [isAuthenticated]);

  useEffect(() => {
    checkPermissions();
  }, []);

  const checkPermissions = async () => {
    if (Platform.OS === 'web') {
      setPermissionStatus('unavailable');
      setPushLoading(false);
      return;
    }
    try {
      const { status } = await ExpoNotifications.getPermissionsAsync();
      setPermissionStatus(status);
      setPushEnabled(status === "granted");
    } catch {
      setPermissionStatus("unavailable");
    } finally {
      setPushLoading(false);
    }
  };

  const handleTogglePush = async (value: boolean) => {
    if (Platform.OS === 'web') return;
    if (value) {
      const { status } = await ExpoNotifications.requestPermissionsAsync();
      setPermissionStatus(status);
      setPushEnabled(status === "granted");
    } else {
      setPushEnabled(false);
    }
  };

  const handleNotificationPress = useCallback((notification: Notification) => {
    if (notification.status !== 'read') {
      markAsRead.mutate(notification._id);
    }
    // If the notification references a note, open that note.
    if (notification.noteId) {
      router.push(`/n/${notification.noteId}`);
    }
  }, [markAsRead, router]);

  const notifications = data?.notifications || [];
  const unreadCount = data?.unreadCount || 0;

  const StatusIcon = pushEnabled ? Bell : BellOff;

  return (
    <ScrollView className="flex-1 bg-background">
      <PageHeader
        safeArea={false}
        title={t("notifications.title")}
        leading={<AppShellMenuButton />}
        actions={
          <ButtonGroup>
            {unreadCount > 0 && <Button
              iconOnly
              icon={RiCheckDoubleLine}
              accessibilityLabel={t("notifications.markAllRead")}
              disabled={markAllAsRead.isPending}
              onPress={() => markAllAsRead.mutate()}
            />}
            <Button
              iconOnly
              icon={RiNotification3Line}
              accessibilityLabel={t("notifications.pushNotifications")}
              pressed={showSettings}
              onPress={() => setShowSettings((shown) => !shown)}
            />
          </ButtonGroup>
        }
      />

      {/* Push Settings (collapsible) */}
      {showSettings && (
        <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)}>
          <View className="px-6 py-4 border-b border-border bg-muted/30">
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center gap-3 flex-1">
                <StatusIcon size={20} className="text-muted-foreground" />
                <View className="flex-1">
                  <Text className="text-sm font-medium text-foreground">{t('notifications.pushNotifications')}</Text>
                  <Text className="text-xs text-muted-foreground mt-0.5">
                    {t('notifications.pushDescription')}
                  </Text>
                </View>
              </View>
              <Switch
                value={pushEnabled}
                onValueChange={handleTogglePush}
                disabled={pushLoading || Platform.OS === "web"}
              />
            </View>
            {permissionStatus === "denied" && (
              <View className="mt-3 p-3 rounded-lg bg-muted">
                <Text className="text-xs text-muted-foreground">
                  {t('notifications.permissionDenied')}
                </Text>
              </View>
            )}
          </View>
        </Animated.View>
      )}

      {/* Notification Feed */}
      {isError ? <EmptyState sticker="loadError" title={t('emptyStates.notificationsError')}
        subtitle={t('emptyStates.notificationsErrorSubtitle')}
        action={{ label: t('emptyStates.retry'), onPress: () => { void refetch(); } }} /> : isLoading ? (
        <View className="items-center justify-center py-12">
          <Text className="text-sm text-muted-foreground">{t('common.loading')}</Text>
        </View>
      ) : notifications.length === 0 ? (
        <EmptyState sticker="notifications" title={t('emptyStates.notificationsTitle')}
          subtitle={t('emptyStates.notificationsSubtitle')}
          action={{ label: t('notes.remindersTitle'), onPress: () => router.push('/reminders') }} />
      ) : (
        <View className="py-2">
          {notifications.map((notification) => {
            const Icon = TYPE_ICONS[notification.type] || Bell;
            const isUnread = notification.status !== 'read' && notification.status !== 'dismissed';
            const priorityBorder = PRIORITY_COLORS[notification.priority] || PRIORITY_COLORS.normal;

            return (
              <Pressable
                key={notification._id}
                onPress={() => handleNotificationPress(notification)}
                className={`px-6 py-4 border-b border-border border-l-2 ${priorityBorder} ${isUnread ? 'bg-muted/20' : ''} active:bg-muted/40`}
              >
                <View className="flex-row items-start gap-3">
                  <View className={`mt-0.5 ${isUnread ? 'opacity-100' : 'opacity-50'}`}>
                    <Icon size={16} className="text-muted-foreground" />
                  </View>
                  <View className="flex-1">
                    <View className="flex-row items-center justify-between mb-1">
                      <Text className={`text-sm ${isUnread ? 'font-semibold text-foreground' : 'font-medium text-muted-foreground'}`} numberOfLines={1}>
                        {notification.title}
                      </Text>
                      <View className="flex-row items-center gap-2">
                        <Text className="text-xs text-muted-foreground">
                          {timeAgo(notification.createdAt)}
                        </Text>
                        <Pressable
                          onPress={(e) => {
                            e.stopPropagation();
                            dismiss.mutate(notification._id);
                          }}
                          className="p-1"
                          hitSlop={8}
                        >
                          <X size={12} className="text-muted-foreground" />
                        </Pressable>
                      </View>
                    </View>
                    <Text className="text-xs text-muted-foreground" numberOfLines={3}>
                      {notification.body}
                    </Text>
                  </View>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}
