import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { useNotedSettings, type SettingsPage } from './settings-provider';

/** Preserve existing links while presenting the single settings dialog over notes. */
export function SettingsRoute({ page }: { page: SettingsPage }) {
  const router = useRouter();
  const { open } = useNotedSettings();
  useEffect(() => {
    open(page);
    router.replace('/(app)');
  }, [open, page, router]);
  return null;
}
