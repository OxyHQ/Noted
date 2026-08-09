import { afterEach, describe, expect, it, vi } from 'vitest';

const DEFAULT_CLIENT_ID = 'oxy_dk_6850133a8633e1941722ad912766db4c60985f1102eaf658';

/** Re-import the module with a given env, since it reads `process.env` at load. */
async function loadClientId(value: string | undefined): Promise<string> {
  vi.resetModules();
  if (value === undefined) {
    delete process.env.EXPO_PUBLIC_OXY_CLIENT_ID;
  } else {
    process.env.EXPO_PUBLIC_OXY_CLIENT_ID = value;
  }
  const { OXY_CLIENT_ID } = await import('@/lib/oxy-client-id');
  return OXY_CLIENT_ID;
}

afterEach(() => {
  delete process.env.EXPO_PUBLIC_OXY_CLIENT_ID;
});

describe('OXY_CLIENT_ID', () => {
  it('uses the registered client id when nothing overrides it', async () => {
    expect(await loadClientId(undefined)).toBe(DEFAULT_CLIENT_ID);
  });

  it('honours a real override', async () => {
    expect(await loadClientId('oxy_dk_something_else')).toBe('oxy_dk_something_else');
  });

  // The case that took sign-in down. `deploy-cloudflare.yml` passes
  // `${{ vars.EXPO_PUBLIC_OXY_CLIENT_ID }}`, and GitHub substitutes an EMPTY
  // STRING for a variable that does not exist — which `??` accepts, because it
  // only falls back on null/undefined. The live bundle shipped with no client id
  // and every sign-in answered "missing clientId".
  it('falls back when the variable is present but empty', async () => {
    expect(await loadClientId('')).toBe(DEFAULT_CLIENT_ID);
  });

  it('falls back when the variable is only whitespace', async () => {
    expect(await loadClientId('   ')).toBe(DEFAULT_CLIENT_ID);
  });

  it('never resolves to something unusable', async () => {
    for (const value of [undefined, '', '  ', '\n']) {
      const clientId = await loadClientId(value);
      expect(clientId.trim().length).toBeGreaterThan(0);
    }
  });
});
