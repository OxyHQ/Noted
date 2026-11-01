import * as Crypto from 'expo-crypto';

/** Stable namespace for the account that started a native recording. */
export async function captureOwnerKey(viewerId: string | null): Promise<string> {
  if (!viewerId) throw new Error('A recording needs an active account');
  const key = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, viewerId);
  if (key.length !== 64 || /[^a-f0-9]/.test(key)) throw new Error('Invalid account namespace');
  return key;
}

/** Construct only paths owned by the app's native recording engines. */
export function nativeCaptureReference(
  ownerKey: string,
  captureId: string,
  extension: 'wav' | 'm4a',
): string {
  if (ownerKey.length !== 64 || /[^a-f0-9]/.test(ownerKey))
    throw new Error('Invalid account namespace');
  if (!captureId || captureId.length > 128 || /[^A-Za-z0-9_-]/.test(captureId))
    throw new Error('Invalid capture identifier');
  if (extension !== 'wav' && extension !== 'm4a') throw new Error('Unsupported recording format');
  return `captures-v2/${ownerKey}/${captureId}/audio.${extension}`;
}
