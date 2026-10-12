import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { stubEnv, unstubAllEnvs } from './stubs';

const publisher = {
  observeHttp: mock((_req: unknown, _res: unknown, next: () => void) => next()),
  installFetch: mock(),
  observeSocket: mock(),
  stop: mock(async () => undefined),
};
const create = mock((_options: unknown) => publisher);
// `mock.module` is not hoisted, so the modules under test are imported after it.
mock.module('@oxy.so/core/server', () => ({
  createEcosystemTraffic: create,
  canAttestWorkloadIdentity: () => false,
  OxyServer: class {},
}));
const { resetOxyServiceClientForTests } = await import('../capabilities/oxy-service-client');
const {
  ecosystemActivityMiddleware,
  observeEcosystemSocket,
  startEcosystemActivity,
  stopEcosystemActivity,
} = await import('../ecosystemActivity');

describe('ecosystem activity lifecycle', () => {
  beforeEach(() => {
    stubEnv('OXY_ECOSYSTEM_ACTIVITY_ENABLED', 'true');
    stubEnv('OXY_APPLICATION_KEY', 'test-key');
    stubEnv('OXY_APPLICATION_SECRET', 'test-secret');
    spyOn(console, 'warn').mockImplementation(() => undefined);
    mock.clearAllMocks();
    resetOxyServiceClientForTests();
  });
  afterEach(async () => {
    await stopEcosystemActivity();
    unstubAllEnvs();
    mock.restore();
  });

  it('does not start or publish when explicitly disabled', () => {
    stubEnv('OXY_ECOSYSTEM_ACTIVITY_ENABLED', 'false');
    startEcosystemActivity(() => true);
    expect(create).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
    const next = mock();
    ecosystemActivityMiddleware({} as never, {} as never, next);
    observeEcosystemSocket({} as never);
    expect(next).toHaveBeenCalledTimes(1);
    expect(publisher.observeSocket).not.toHaveBeenCalled();
  });

  it('makes missing activation visible without starting a publisher', () => {
    stubEnv('OXY_ECOSYSTEM_ACTIVITY_ENABLED', undefined);
    startEcosystemActivity(() => true);
    expect(create).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
  });

  it('rejects a misspelled activation instead of silently losing coverage', () => {
    stubEnv('OXY_ECOSYSTEM_ACTIVITY_ENABLED', 'tru');
    expect(() => startEcosystemActivity(() => true)).toThrow('must be true or false');
  });

  it('fails boot when the shared collector rejects its configuration', () => {
    create.mockImplementationOnce(() => {
      throw new Error('Invalid infrastructure region');
    });
    expect(() => startEcosystemActivity(() => true)).toThrow('Invalid infrastructure region');
    expect(publisher.installFetch).not.toHaveBeenCalled();
  });

  it('refuses a partially provisioned publishing credential', () => {
    stubEnv('OXY_APPLICATION_SECRET', '');
    expect(() => startEcosystemActivity(() => true)).toThrow('OXY_APPLICATION_SECRET');
    expect(create).not.toHaveBeenCalled();
  });

  it('installs once and supplies live readiness without retaining request bodies', async () => {
    let ready = false;
    startEcosystemActivity(() => ready);
    startEcosystemActivity(() => ready);
    expect(create).toHaveBeenCalledTimes(1);
    expect(publisher.installFetch).toHaveBeenCalledTimes(1);
    const socket = {} as never;
    observeEcosystemSocket(socket);
    expect(publisher.observeSocket).toHaveBeenCalledWith(socket);
    const options = create.mock.calls[0]?.[0] as unknown as { service: string; ready(): boolean };
    expect(options.service).toBe('noted');
    expect(options.ready()).toBe(false);
    ready = true;
    expect(options.ready()).toBe(true);
    const next = mock();
    ecosystemActivityMiddleware({} as never, {} as never, next);
    expect(publisher.observeHttp).toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    await stopEcosystemActivity();
    await stopEcosystemActivity();
    expect(publisher.stop).toHaveBeenCalledTimes(1);
  });
});
