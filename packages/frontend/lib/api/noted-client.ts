import type { OxyServices } from '@oxy.so/core';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
type Query = {
  params?: Record<string, string | number | boolean | null | undefined>;
  /** Reject/abort if a queued account-owned operation outlives its session. */
  expectedViewerId?: string;
};

/** Keep Noted's complete JSON bodies, including sync tombstones and serverTime. */
export function createNotedClient(oxy: OxyServices, baseURL: string, timeoutMs = 10_000) {
  const linked = oxy.createLinkedClient({ baseURL });

  async function request<T>(
    method: Method,
    path: string,
    body?: unknown,
    query?: Query,
  ): Promise<{ data: T }> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query?.params ?? {})) {
      if (value !== undefined && value !== null) params.set(key, String(value));
    }
    const suffix = params.toString();
    const url = suffix ? `${path}${path.includes('?') ? '&' : '?'}${suffix}` : path;
    const controller = new AbortController();
    const expectedViewerId = query?.expectedViewerId;
    const assertAccount = () => {
      if (expectedViewerId !== undefined && oxy.session.userId !== expectedViewerId) {
        throw new Error('The active account changed before this request completed');
      }
    };
    assertAccount();
    const unsubscribe =
      expectedViewerId === undefined
        ? undefined
        : oxy.session.onChange(() => {
            if (oxy.session.userId !== expectedViewerId) controller.abort();
          });
    // One deadline covers headers, response body and the SDK's bounded 401 retry.
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await linked.client.requestAuthenticatedResponse({
        method,
        url,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
      });
      const text = await response.text();
      assertAccount();
      let data: unknown = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          // Keep known HTTP errors even when a proxy returns HTML/plain text.
          // Never expose that untrusted body as a diagnostic message.
          if (response.ok) throw new Error('Invalid JSON response');
        }
      }
      if (!response.ok) {
        const message =
          typeof data === 'object' &&
          data !== null &&
          'error' in data &&
          typeof data.error === 'string'
            ? data.error
            : `Request failed with status ${response.status}`;
        // Existing Noted callers inspect response.status (404 deletes) and data.error.
        throw Object.assign(new Error(message), { response: { status: response.status, data } });
      }
      return { data: data as T };
    } finally {
      clearTimeout(timer);
      unsubscribe?.();
    }
  }

  return {
    get: <T = unknown>(path: string, query?: Query) => request<T>('GET', path, undefined, query),
    post: <T = unknown>(path: string, body?: unknown, query?: Query) =>
      request<T>('POST', path, body, query),
    put: <T = unknown>(path: string, body?: unknown, query?: Query) =>
      request<T>('PUT', path, body, query),
    patch: <T = unknown>(path: string, body?: unknown, query?: Query) =>
      request<T>('PATCH', path, body, query),
    delete: <T = unknown>(path: string, query?: Query) =>
      request<T>('DELETE', path, undefined, query),
    isAccountActive: (viewerId: string) => oxy.session.userId === viewerId,
    dispose: linked.dispose,
  };
}

/**
 * The server's `error` string on a failed request, if it sent one. Requests
 * reject with `response.data` attached (see createNotedClient); anything else
 * thrown — a network failure, a timeout, a non-Error — has none.
 */
export function responseErrorMessage(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('response' in error)) return undefined;
  const { response } = error;
  if (typeof response !== 'object' || response === null || !('data' in response)) return undefined;
  const { data } = response;
  if (typeof data !== 'object' || data === null || !('error' in data)) return undefined;
  return typeof data.error === 'string' && data.error ? data.error : undefined;
}
