import { Lock } from 'lucide-react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import React from 'react';
import { AppState, Platform, StyleSheet, View } from 'react-native';
import { Button } from '@oxy.so/bloom/button';
import { Text } from '@/components/ui/text';
import { useTranslation } from '@/hooks/useTranslation';
import { SETTING_KEYS, readSetting, useSettings } from '@/lib/db/settings-repo';
import { useCanAuthenticate } from '@/lib/hooks/use-app-lock-support';
import { initialLocked, lockOnReturn } from '@/lib/app-lock';
import { useColorScheme } from '@/lib/useColorScheme';

const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';

/**
 * Covers the app until the person authenticates, when they turned that on.
 *
 * Off by default and native-only. The children stay mounted underneath rather
 * than being replaced: unlocking must put the person back exactly where they
 * were, mid-note, not on a freshly built screen. The rules for when it engages
 * are in `lib/app-lock.ts`; this is the prompt and the cover.
 *
 * It listens for `background`, not `inactive`: on iOS the Face ID sheet itself
 * makes the app inactive, and treating that as "left the app" would lock it again
 * the moment it unlocked.
 */
export function AppLockGate({ children }: { children: React.ReactNode }) {
  if (Platform.OS === 'web') return <>{children}</>;
  return <NativeLockGate>{children}</NativeLockGate>;
}

function NativeLockGate({ children }: { children: React.ReactNode }) {
  const { settings, isLoading } = useSettings();
  const canAuthenticate = useCanAuthenticate();
  const enabled = readSetting(settings, SETTING_KEYS.appLock, isBoolean, false);

  // `undefined` until both answers are in, so the first frame is decided once
  // with real values instead of flashing content at someone who has a lock.
  const ready = !isLoading && canAuthenticate !== null;
  const input = React.useMemo(
    () => ({ enabled, canAuthenticate: canAuthenticate === true }),
    [enabled, canAuthenticate],
  );

  const [locked, setLocked] = React.useState(true);
  const decided = React.useRef(false);
  const backgroundedAt = React.useRef<number | null>(null);

  React.useEffect(() => {
    if (!ready) return;
    if (!decided.current) {
      decided.current = true;
      setLocked(initialLocked(input));
    } else if (!input.enabled || !input.canAuthenticate) {
      // Turned off, or nothing left to authenticate with: never trap the person.
      setLocked(false);
    }
  }, [ready, input]);

  React.useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background') {
        backgroundedAt.current = Date.now();
      } else if (state === 'active') {
        if (lockOnReturn(input, backgroundedAt.current, Date.now())) setLocked(true);
        backgroundedAt.current = null;
      }
    });
    return () => subscription.remove();
  }, [input]);

  return (
    <View style={styles.fill}>
      {children}
      {(!ready || locked) && <LockCover waiting={!ready} onUnlocked={() => setLocked(false)} />}
    </View>
  );
}

function LockCover({ waiting, onUnlocked }: { waiting: boolean; onUnlocked: () => void }) {
  const { t } = useTranslation();
  const { colors } = useColorScheme();
  const [failed, setFailed] = React.useState(false);
  const prompting = React.useRef(false);

  const unlock = React.useCallback(async () => {
    if (prompting.current) return;
    prompting.current = true;
    setFailed(false);
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: t('lock.prompt'),
        cancelLabel: t('common.cancel'),
      });
      if (result.success) onUnlocked();
      else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      prompting.current = false;
    }
  }, [onUnlocked, t]);

  // Ask as soon as the cover is real (not while still deciding whether to lock).
  React.useEffect(() => {
    if (!waiting) void unlock();
  }, [waiting, unlock]);

  return (
    <View
      style={[StyleSheet.absoluteFill, styles.cover, { backgroundColor: colors.background }]}
      accessibilityViewIsModal
    >
      {!waiting && (
        <>
          <Lock size={40} color={colors.mutedForeground} />
          <Text className="text-lg font-semibold text-foreground">{t('lock.title')}</Text>
          {failed && (
            <Text accessibilityRole="alert" className="text-sm text-muted-foreground">
              {t('lock.failed')}
            </Text>
          )}
          <Button onPress={() => void unlock()}>{t('lock.unlock')}</Button>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  cover: { alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
});
