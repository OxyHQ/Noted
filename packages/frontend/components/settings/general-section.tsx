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
import { COLOR_PRESET_REGISTRY, useBloomTheme, type AppColorName } from '@oxy.so/bloom/theme';
import { getNativeLanguageName } from '@oxy.so/core';
import { useOxy } from '@oxy.so/services';
import { useColorScheme } from '@/lib/useColorScheme';
import { useTranslation } from '@/hooks/useTranslation';
import { useExportAll } from '@/lib/hooks/use-export-all';
import { useImportNotes } from '@/lib/hooks/use-import-notes';
import { useNotedSettings } from './settings-provider';

export function GeneralSection() {
  const { mode, setColorScheme } = useColorScheme();
  const { colorPreset, setColorPreset } = useBloomTheme();
  const { t } = useTranslation();
  const { currentLanguage, currentLanguages, showBottomSheet } = useOxy();
  const { afterClose } = useNotedSettings();
  const { pickAndImport, importing } = useImportNotes();
  const { exportAll, exporting } = useExportAll();
  const modes = (['system', 'light', 'dark'] as const).map((value) => ({
    value,
    label: t(`settings.appearance.${value}`),
  }));
  // Bloom owns the preset catalogue and its display names; new presets must not
  // become missing translation keys in this app. Respect reserved/premium gates.
  const colors = COLOR_PRESET_REGISTRY.filter(
    (preset) => !preset.gate || preset.name === colorPreset,
  ).map((preset) => ({ value: preset.name, label: preset.displayName }));
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
              value={colorPreset}
              onValueChange={(value) => {
                if (colors.some((color) => color.value === value))
                  setColorPreset(value as AppColorName);
              }}
            >
              <SelectTrigger label={t('settings.accentColor.title')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent
                items={colors}
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
        </SettingsCard>
      </SettingsSection>
    </View>
  );
}
