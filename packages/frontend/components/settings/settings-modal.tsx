import { useState } from 'react';
import { useOxy } from '@oxy.so/services';
import { SettingsModal, type SettingsNavGroup } from '@oxy.so/bloom/settings-modal';
import { RiUserLine } from '@oxy.so/bloom/icons/RiUserLine';
import { RiSettings3Line } from '@oxy.so/bloom/icons/RiSettings3Line';
import { RiMicLine } from '@oxy.so/bloom/icons/RiMicLine';
import { RiDatabase2Line } from '@oxy.so/bloom/icons/RiDatabase2Line';
import { RiFeedbackLine } from '@oxy.so/bloom/icons/RiFeedbackLine';
import { useTranslation } from '@/hooks/useTranslation';
import { LocalStoreBoundary } from '@/components/local-store-boundary';
import { AccountSection } from './account-section';
import { GeneralSection } from './general-section';
import { SharedStorageSection } from './shared-storage-section';
import { TranscriptionSection } from './transcription-section';
import { FeedbackSection } from './feedback-section';
import type { SettingsPage } from './settings-provider';

function TranscriptionSettings() {
  const { isAuthenticated } = useOxy();
  if (!isAuthenticated) return <AccountSection />;
  return <LocalStoreBoundary><TranscriptionSection /></LocalStoreBoundary>;
}

export default function NotedSettingsModal({ page: initialPage, initialView, onClose }: {
  page: SettingsPage;
  initialView: 'navigation' | 'page';
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [page, setPage] = useState<string>(initialPage);
  const pages = {
    general: { title: t('settings.sections.general'), content: <GeneralSection /> },
    account: { title: t('settings.sections.account'), content: <AccountSection /> },
    storage: { title: t('sharedStorage.title'), content: <SharedStorageSection /> },
    transcription: { title: t('settings.sections.transcription'), content: <TranscriptionSettings /> },
    feedback: { title: t('settings.sections.feedback'), content: <FeedbackSection /> },
  };
  const groups: SettingsNavGroup[] = [{ key: 'settings', label: t('settings.title'), items: [
    { key: 'general', page: 'general', label: pages.general.title, icon: RiSettings3Line },
    { key: 'account', page: 'account', label: pages.account.title, icon: RiUserLine },
    { key: 'storage', page: 'storage', label: pages.storage.title, icon: RiDatabase2Line },
    { key: 'transcription', page: 'transcription', label: pages.transcription.title, icon: RiMicLine },
    { key: 'feedback', page: 'feedback', label: pages.feedback.title, icon: RiFeedbackLine },
  ] }];
  return <SettingsModal open onClose={onClose} page={page} defaultPage={initialPage}
    initialView={initialView} onPageChange={setPage} pages={pages} groups={groups}
    labels={{ dialog: t('settings.title'), close: t('common.close'), back: t('common.back') }} />;
}
