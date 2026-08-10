import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';
import i18n, { resolveSupportedLocale } from '@/lib/i18n';

function getDeviceLocale(): string {
  const locales = getLocales();
  if (!locales || locales.length === 0) return 'en';
  return resolveSupportedLocale(locales[0]?.languageTag || locales[0]?.languageCode);
}

interface I18nState {
  locale: string;
  setLocale: (locale: string) => void;
}

export const useI18nStore = create<I18nState>()(
  persist(
    (set) => ({
      locale: getDeviceLocale(),
      setLocale: (locale: string) => {
        const supportedLocale = resolveSupportedLocale(locale);
        i18n.locale = supportedLocale;
        set({ locale: supportedLocale });
      },
    }),
    {
      name: 'i18n-storage',
      storage: createJSONStorage(() => AsyncStorage),
      onRehydrateStorage: () => (state) => {
        if (state?.locale) {
          const supportedLocale = resolveSupportedLocale(state.locale);
          state.locale = supportedLocale;
          i18n.locale = supportedLocale;
        }
      },
    }
  )
);
