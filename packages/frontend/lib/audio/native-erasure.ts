/** Native-only capture paths cannot be deleted by the generic adapter. */
export async function eraseNativeCaptureAudio(
  _viewerId: string | null,
  _ownerKey: string,
  _id: string,
  _extension: 'wav' | 'm4a',
): Promise<void> {
  throw new Error('Native capture deletion is unavailable');
}
