import { File } from 'expo-file-system';
import type { DocumentPickerAsset } from 'expo-document-picker';

export async function readPickedText(asset: DocumentPickerAsset): Promise<string> {
  return new File(asset.uri).text();
}
