import { AliaChatSheet } from '@alia.onl/sdk';
import React from 'react';
import { useOxy } from '@oxy.so/services';
import { useTranslation } from '@/hooks/useTranslation';
import { aliaChatRef } from '@/lib/alia-chat';

/**
 * Alia's chat, as a sheet.
 *
 * This is a hosted assistant, and it is the one part of Noted that sends what the
 * person types to a server — it says so in the sheet's own subtitle, because the
 * rest of the app promises the opposite for recordings. It is also general: it is
 * not wired to the notes (that is a separate, deliberate step through the
 * capability catalogue), so neither its context nor its suggestions claim it can
 * read them. The SDK sends the signed-in user's Oxy session; Noted holds no
 * credential of its own for it.
 */
export function AliaChatHost() {
  const { t } = useTranslation();
  const { isAuthenticated } = useOxy();

  const suggestions = React.useMemo(
    () =>
      (['plan', 'agenda', 'rewrite'] as const).map((id) => ({
        id,
        title: t(`alia.suggestions.${id}.title`),
        description: t(`alia.suggestions.${id}.prompt`),
      })),
    [t],
  );

  if (!isAuthenticated) return null;
  return (
    <AliaChatSheet
      ref={aliaChatRef}
      clientContext={t('alia.clientContext')}
      welcomeSubtitle={t('alia.subtitle')}
      welcomeSuggestions={suggestions}
    />
  );
}
