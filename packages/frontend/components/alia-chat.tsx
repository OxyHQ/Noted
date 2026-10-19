import { AliaChatSheet } from '@alia.onl/sdk';
import React from 'react';
import { useOxy } from '@oxy.so/services';
import { useTranslation } from '@/hooks/useTranslation';
import { aliaChatRef } from '@/lib/alia-chat';

/**
 * Alia's chat, as a sheet.
 *
 * This is a hosted assistant, and it is the one part of Noted that sends what the
 * person types to a server — the sheet's own subtitle says so, because the rest of
 * the app promises the opposite for recordings.
 *
 * It is not wired to the notes by anything in THIS file. The notes' capability
 * catalog is registered with Oxy by Nilo, which serves the notes (it moved there
 * with them), and Alia builds its tools from that registry, so whether this chat can search
 * the notes is decided there — which is why the context tells the model to use
 * Noted tools if it has them and to say so plainly if it does not, rather than
 * asserting either. The SDK sends the signed-in user's Oxy session; Noted holds no
 * credential of its own for it.
 *
 * The chat is text-only (`voice={false}`): @alia.onl/sdk turns its voice call on by
 * default since 21.x, and Noted has never offered one — Alia's chat here is typing
 * (and the SDK's dictation), nothing more.
 */
export function AliaChatHost() {
  const { t } = useTranslation();
  const { isAuthenticated } = useOxy();

  const suggestions = React.useMemo(
    () =>
      (['plan', 'agenda', 'rewrite'] as const).map((id) => ({
        id,
        text: t(`alia.suggestions.${id}.title`),
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
      voice={false}
    />
  );
}
