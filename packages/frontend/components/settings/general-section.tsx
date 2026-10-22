import { View } from 'react-native';
import { Button } from '@oxy.so/bloom/button';
import { SettingsCard, SettingsRow, SettingsSection } from '@oxy.so/bloom/settings-modal';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  SelectItemText,
} from '@oxy.so/bloom/select';
import { COLOR_PRESET_REGISTRY } from '@oxy.so/bloom/theme';
import { toast } from '@oxy.so/bloom/toast';
import { getNativeLanguageName } from '@oxy.so/core';
import { useAccountColorSave, useOxy } from '@oxy.so/services/ui/client';
import { useColorScheme } from '@/lib/useColorScheme';
import { useTranslation } from '@/hooks/useTranslation';
import { AppLockSection } from './app-lock-section';
import { LocalRemindersRow } from './local-reminders-section';
import { useExportAll } from '@/lib/hooks/use-export-all';
import { useExportMarkdownZip } from '@/lib/hooks/use-export-markdown-zip';
import { useImportNotes } from '@/lib/hooks/use-import-notes';
import { useNotedSettings } from './settings-provider';

export function GeneralSection() {
  const { mode, setColorScheme } = useColorScheme();
  const { colors, value: colorValue, saveColor } = useAccountColorSave();
  const { t } = useTranslation();
  const { currentLanguage, currentLanguages, showBottomSheet } = useOxy();
  const { afterClose } = useNotedSettings();
  const { pickAndImport, importing } = useImportNotes();
  const { exportAll, exporting } = useExportAll();
  const { exportZip, exportingZip } = useExportMarkdownZip();
  const modes = (['system', 'light', 'dark'] as const).map((value) => ({
    value,
    label: t(`settings.appearance.${value}`),
  }));
  // Bloom owns the preset catalogue and its display names; Oxy decides which
  // presets this account may wear.
  const colorOptions = colors.map((name) => ({
    value: name,
    label: COLOR_PRESET_REGISTRY.find((preset) => preset.name === name)?.displayName ?? name,
  }));
  const languages = currentLanguages.length ? currentLanguages : [currentLanguage];
  return (
    <View className="gap-6">
      <SettingsSection label={t('settings.sections.general')}>
        <SettingsCard>
          <SettingsRow label={t('settings.appLanguage.title')}>
            <Button
              appearance="outline"
              size="sm"
              onPress={() => afterClose(() => showBottomSheet?.('LanguageSelector'))}
            >
              {languages.map(getNativeLanguageName).join(', ')}
            </Button>
          </SettingsRow>
          <SettingsRow label={t('settings.appearance.title')}>
            <Select
              value={mode}
              onValueChange={(value) => {
                if (value === 'light' || value === 'dark' || value === 'system')
                  setColorScheme(value);
              }}
            >
              <SelectTrigger label={t('settings.appearance.title')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent
                items={modes}
                renderItem={(item) => (
                  <SelectItem value={item.value} label={item.label}>
                    <SelectItemText>{item.label}</SelectItemText>
                  </SelectItem>
                )}
              />
            </Select>
          </SettingsRow>
          <SettingsRow label={t('settings.accentColor.title')}>
            <Select
              value={colorValue}
              onValueChange={(value) => {
                const next = colors.find((name) => name === value);
                if (next)
                  saveColor(next).catch(() => toast.error(t('settings.accentColor.saveFailed')));
              }}
            >
              <SelectTrigger label={t('settings.accentColor.title')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent
                items={colorOptions}
                renderItem={(item) => (
                  <SelectItem value={item.value} label={item.label}>
                    <SelectItemText>{item.label}</SelectItemText>
                  </SelectItem>
                )}
              />
            </Select>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
      <AppLockSection />
      <LocalRemindersRow />
      <SettingsSection label={t('settings.import.title')}>
        <SettingsCard>
          <SettingsRow
            label={t('settings.import.title')}
            description={t('settings.import.description')}
          >
            <Button
              appearance="outline"
              size="sm"
              disabled={importing}
              onPress={() => {
                void pickAndImport();
              }}
            >
              {t('settings.import.button')}
            </Button>
          </SettingsRow>
          <SettingsRow
            label={t('settings.export.title')}
            description={t('settings.export.description')}
          >
            <Button
              appearance="outline"
              size="sm"
              disabled={exporting}
              onPress={() => {
                void exportAll();
              }}
            >
              {t('settings.export.button')}
            </Button>
          </SettingsRow>
          <SettingsRow
            label={t('settings.export.markdownTitle')}
            description={t('settings.export.markdownDescription')}
          >
            <Button
              appearance="outline"
              size="sm"
              disabled={exportingZip}
              onPress={() => {
                void exportZip();
              }}
            >
              {t('settings.export.markdownButton')}
            </Button>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
    </View>
  );
}
