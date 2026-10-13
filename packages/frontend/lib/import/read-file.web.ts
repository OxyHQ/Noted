import type { DocumentPickerAsset } from 'expo-document-picker';

export async function readPickedText(asset: DocumentPickerAsset): Promise<string> {
  if (asset.file) return asset.file.text();
  return (await fetch(asset.uri)).text();
}
