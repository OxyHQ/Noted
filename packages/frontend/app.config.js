/**
 * `app.json`, plus what it cannot say:
 *
 * - Use Firebase's `google-services.json` (Android push) only when it is there.
 *   It is not in the repository; without it, a build of the Android app still
 *   works, with no push notifications, instead of failing in `expo prebuild`.
 * - The app variant: `APP_VARIANT=development` builds `so.oxy.noted.dev` with its
 *   own name, so it sits next to the production app on the same device.
 *   Commons' and @oxy.so/services' caller allow-lists hold both ids.
 */
const { existsSync } = require('node:fs');
const { resolve } = require('node:path');

const IS_DEV_VARIANT = process.env.APP_VARIANT === 'development';
const APP_ID = IS_DEV_VARIANT ? 'so.oxy.noted.dev' : 'so.oxy.noted';
const APP_NAME = IS_DEV_VARIANT ? 'Noted (Dev)' : 'Noted';

module.exports = ({ config }) => {
  const next = {
    ...config,
    name: APP_NAME,
    ios: { ...config.ios, bundleIdentifier: APP_ID },
    android: { ...config.android, package: APP_ID },
  };
  const file = next.android?.googleServicesFile;
  if (!file || existsSync(resolve(__dirname, file))) return next;
  console.warn(`[app.config] ${file} is missing: this Android build has no push notifications.`);
  const { googleServicesFile: _missing, ...android } = next.android;
  return { ...next, android };
};
