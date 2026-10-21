import { createRef } from 'react';
import type { AliaChatSheetRef } from '@alia.onl/sdk/text';

/**
 * The one chat sheet the app mounts (`components/alia-chat.tsx`), reachable from
 * anywhere that wants to open it — the notes header and the command palette —
 * without threading a ref through the layout.
 */
export const aliaChatRef = createRef<AliaChatSheetRef>();

export function openAliaChat(): void {
  aliaChatRef.current?.present();
}
