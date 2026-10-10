import { EmptyState as BloomEmptyState } from '@oxy.so/bloom/empty-state';
import { EmptyStateSticker } from '@/components/common/EmptyStateSticker';
import type { EmptyStateStickerName } from '@/lib/stickers';

/** One accessible, responsive empty state for every Noted surface. */
export function EmptyState({
  sticker,
  title,
  subtitle,
  action,
}: {
  sticker: EmptyStateStickerName;
  title: string;
  subtitle?: string;
  action?: { label: string; onPress: () => void };
}) {
  return (
    <BloomEmptyState
      illustration={<EmptyStateSticker name={sticker} />}
      title={title}
      description={subtitle}
      action={action}
      style={{ paddingVertical: 48, paddingHorizontal: 24 }}
    />
  );
}
