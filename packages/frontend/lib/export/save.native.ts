/**
 * Handing the file to the user, on a phone.
 *
 * A share sheet, because a phone has no folder the person browses — the file is
 * useful at the moment it reaches Files, a mail draft, or another app. It is
 * written to the app's cache first: the sheet shares a file, not a string, and
 * the cache is the right place for something whose only job is to be handed on.
 */

import { Directory, File, Paths } from 'expo-file-system';
import { isAvailableAsync, shareAsync } from 'expo-sharing';

const MIME_TYPE = 'text/markdown';

export async function saveTextFile(filename: string, contents: string): Promise<void> {
  if (!(await isAvailableAsync())) {
    throw new Error('this device has no way to share a file');
  }

  // One directory, so a failed share leaves one place to clean rather than
  // scattering exports through the cache.
  const directory = new Directory(Paths.cache, 'exports');
  directory.create({ intermediates: true, idempotent: true });

  const file = new File(directory, filename);
  // A previous export of the same note would otherwise be appended to, and the
  // user would share a file containing their note twice.
  if (file.exists) file.delete();
  file.create();
  file.write(contents);

  await shareAsync(file.uri, { mimeType: MIME_TYPE, UTI: 'net.daringfireball.markdown' });
}
