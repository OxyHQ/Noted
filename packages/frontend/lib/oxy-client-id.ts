/**
 * Noted's registered Oxy client id.
 *
 * Its own module, with no React Native import, because it has nothing to do with
 * the platform: `lib/config.ts` needs `Platform` to choose an API URL, and that
 * import is enough to keep this value out of a plain node test — which is
 * exactly where the bug below needed to be pinned.
 */

/**
 * The ApplicationCredential publicKey for the official "Noted" Application
 * (redirect origin https://noted.oxy.so), required by `@oxyhq/services` for the
 * device sign-in / SSO cold boot. An `oxy_dk_` public key is public and safe to
 * commit.
 */
const DEFAULT_OXY_CLIENT_ID = 'oxy_dk_6850133a8633e1941722ad912766db4c60985f1102eaf658';

/**
 * Read an environment override, treating "set to nothing" as "not set".
 *
 * Those two are the same thing here, and telling them apart is what took sign-in
 * down in production. `deploy-cloudflare.yml` passes
 * `EXPO_PUBLIC_OXY_CLIENT_ID: ${{ vars.EXPO_PUBLIC_OXY_CLIENT_ID }}`; when that
 * repository variable does not exist GitHub substitutes an EMPTY STRING rather
 * than leaving the variable unset, and `??` only falls back on `null` and
 * `undefined`. The empty string sailed through as the client id, the live bundle
 * contained none, and every sign-in answered "This app is not configured for
 * sign-in (missing clientId)".
 *
 * Whitespace is trimmed too: a variable set through a web form picks it up, and
 * `" "` is as unusable as `""`.
 */
export function readClientId(value: string | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : DEFAULT_OXY_CLIENT_ID;
}

export { DEFAULT_OXY_CLIENT_ID };

export const OXY_CLIENT_ID = readClientId(process.env.EXPO_PUBLIC_OXY_CLIENT_ID);
