/**
 * `app.json`, plus the one thing it cannot say: use Firebase's
 * `google-services.json` (Android push) only when it is there. It is not in
 * the repository; without it, a build of the Android app still works, with no
 * push notifications, instead of failing in `expo prebuild`.
 */
const { existsSync } = require('node:fs');
const { resolve } = require('node:path');

module.exports = ({ config }) => {
  const file = config.android?.googleServicesFile;
  if (!file || existsSync(resolve(__dirname, file))) return config;
  console.warn(`[app.config] ${file} is missing: this Android build has no push notifications.`);
  const { googleServicesFile: _missing, ...android } = config.android;
  return { ...config, android };
};
