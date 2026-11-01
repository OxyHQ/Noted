import { requireNativeModule } from 'expo';
import { captureOwnerKey } from '@/lib/audio/capture-owner';
import { withActiveViewerLease } from '@/lib/db/client';

interface NativeAudioErasure {
  eraseCaptureAudio(ownerKey: string, captureId: string, extension: 'wav' | 'm4a'): Promise<void>;
}

/** Older binaries do not contain the bridge and must retain the capture row. */
function nativeErasure(): NativeAudioErasure {
  try {
    return requireNativeModule<NativeAudioErasure>('NotedAudioErasure');
  } catch {
    throw new Error('Native audio deletion requires an updated app');
  }
}

export function eraseNativeCaptureAudio(
  viewerId: string | null,
  ownerKey: string,
  captureId: string,
  extension: 'wav' | 'm4a',
): Promise<void> {
  return withActiveViewerLease(viewerId, async () => {
    if ((await captureOwnerKey(viewerId)) !== ownerKey) {
      throw new Error('Capture audio belongs to another account');
    }
    await nativeErasure().eraseCaptureAudio(ownerKey, captureId, extension);
  });
}
