import { beforeEach, describe, expect, it, mock } from 'bun:test';

const mocks = {
  serviceToken: mock(),
  invalidateServiceToken: mock(),
  constructed: mock(),
  canAttest: mock(() => false),
};

// `mock.module` is not hoisted, so the module under test is imported after it.
mock.module('@oxy.so/core/server', () => ({
  canAttestWorkloadIdentity: () => mocks.canAttest(),
  OxyServer: class {
    constructor(options: unknown) {
      mocks.constructed(options);
    }

    serviceToken(): Promise<string> {
      return mocks.serviceToken() as Promise<string>;
    }

    invalidateServiceToken(): void {
      mocks.invalidateServiceToken();
    }
  },
}));

const {
  invalidateOxyServiceToken,
  oxyServiceClient,
  requiredOxyServiceToken,
  resetOxyServiceClientForTests,
} = await import('../oxy-service-client.js');

beforeEach(() => {
  delete process.env.OXY_APPLICATION_KEY;
  delete process.env.OXY_APPLICATION_SECRET;
  resetOxyServiceClientForTests();
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.canAttest.mockReturnValue(false);
});

describe('Noted Oxy service client', () => {
  it('fails closed when either application credential is absent', async () => {
    process.env.OXY_APPLICATION_KEY = 'key-only';

    expect(oxyServiceClient()).toBeNull();
    await expect(requiredOxyServiceToken()).rejects.toThrow('Noted has no Oxy identity');
    expect(mocks.constructed).not.toHaveBeenCalled();
  });

  it('configures one cached application client without handling user tokens', async () => {
    process.env.OXY_APPLICATION_KEY = 'application-key';
    process.env.OXY_APPLICATION_SECRET = 'application-secret';
    mocks.serviceToken.mockResolvedValueOnce('service-token');

    const first = oxyServiceClient();
    const second = oxyServiceClient();

    expect(first).toBe(second);
    expect(mocks.constructed).toHaveBeenCalledTimes(1);
    expect(mocks.constructed).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceAuth: { apiKey: 'application-key', apiSecret: 'application-secret' },
      }),
    );
    await expect(requiredOxyServiceToken()).resolves.toBe('service-token');
    invalidateOxyServiceToken();
    expect(mocks.invalidateServiceToken).toHaveBeenCalledTimes(1);
  });

  it('attests its task role when no key pair is configured', async () => {
    mocks.canAttest.mockReturnValue(true);
    mocks.serviceToken.mockResolvedValueOnce('workload-token');

    expect(oxyServiceClient()).not.toBeNull();
    expect(mocks.constructed).toHaveBeenCalledWith(
      expect.not.objectContaining({ serviceAuth: expect.anything() }),
    );
    await expect(requiredOxyServiceToken()).resolves.toBe('workload-token');
  });

  it('never treats half a key pair as an attestation', () => {
    mocks.canAttest.mockReturnValue(true);
    process.env.OXY_APPLICATION_SECRET = 'secret-only';

    expect(oxyServiceClient()).toBeNull();
    expect(mocks.constructed).not.toHaveBeenCalled();
  });
});
