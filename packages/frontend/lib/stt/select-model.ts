import { getActiveViewerId } from '@/lib/db/client';
import { SETTING_KEYS, writeSetting } from '@/lib/db/settings-repo';
import type { SttModelId } from '@/lib/stt/models';

/** A download may outlive its settings page and the account that requested it. */
export async function selectSttModel(
  modelId: SttModelId,
  ensureDownloaded: () => Promise<void>,
): Promise<void> {
  const expectedViewerId = getActiveViewerId();
  await ensureDownloaded();
  await writeSetting(SETTING_KEYS.sttModel, modelId, expectedViewerId);
}
