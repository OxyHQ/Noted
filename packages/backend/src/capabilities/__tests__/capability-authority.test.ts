import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { stubGlobal, unstubAllGlobals } from '../../__tests__/stubs';

const mocks = { requiredOxyServiceToken: mock() };

// `mock.module` is not hoisted, so the module under test is imported after it.
mock.module('../oxy-service-client.js', () => ({
  requiredOxyServiceToken: mocks.requiredOxyServiceToken,
}));

const { auditNotedCapabilityTicket } = await import('../capability-authority.js');

beforeEach(() => {
  unstubAllGlobals();
  mocks.requiredOxyServiceToken.mockReset();
  mocks.requiredOxyServiceToken.mockResolvedValue('service-token');
});

describe('Noted capability authority client', () => {
  it('sends a pre-hashed idempotency key as a hash, never as plaintext', async () => {
    const fetchMock = mock().mockResolvedValue(new Response('{}', { status: 200 }));
    stubGlobal('fetch', fetchMock);

    await auditNotedCapabilityTicket({
      ticket: 'signed-ticket',
      result: { status: 'succeeded' },
      rollbackSupported: false,
      idempotencyKeyHash: 'a'.repeat(64),
    });

    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(request.body as string)).toEqual({
      ticket: 'signed-ticket',
      result: { status: 'succeeded' },
      rollback: { supported: false, attempted: false },
      idempotencyKeyHash: 'a'.repeat(64),
    });
  });
});
