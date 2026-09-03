import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ requiredOxyServiceToken: vi.fn() }));

vi.mock('../oxy-service-client.js', () => ({
  requiredOxyServiceToken: mocks.requiredOxyServiceToken,
}));

import { auditNotedCapabilityTicket } from '../capability-authority.js';

beforeEach(() => {
  vi.unstubAllGlobals();
  mocks.requiredOxyServiceToken.mockReset();
  mocks.requiredOxyServiceToken.mockResolvedValue('service-token');
});

describe('Noted capability authority client', () => {
  it('sends a pre-hashed idempotency key as a hash, never as plaintext', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

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
