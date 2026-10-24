/**
 * `app.json`, plus what it cannot say:
 *
 * - Use Firebase's `google-services.json` (Android push) only when it is there.
 *   It is not in the repository; without it, a build of the Android app still
 *   works, with no push notifications, instead of failing in `expo prebuild`.
 * - Bundle development builds with Noxcturnal, which depends on NODE_ENV.
 */
const { existsSync } = require('node:fs');
const { resolve } = require('node:path');

module.exports = ({ config }) => {
  const next = {
    ...config,
    experiments: {
      ...config.experiments,
      // Expo's oxc transformer, about 2x faster cold bundles than Babel. Development
      // only: in a production export it keeps the requires of dead platform branches
      // (`if (Platform.OS !== 'web') require(...)`), pulling native-only packages into
      // the web bundle. The CLI sets NODE_ENV before it reads this config.
      noxcturnalTransformWorker: process.env.NODE_ENV !== 'production',
    },
  };
  const file = next.android?.googleServicesFile;
  if (!file || existsSync(resolve(__dirname, file))) return next;
  console.warn(`[app.config] ${file} is missing: this Android build has no push notifications.`);
  const { googleServicesFile: _missing, ...android } = next.android;
  return { ...next, android };
};
