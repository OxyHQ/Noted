import type { OxyServices } from '@oxy.so/core';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
type Query = { params?: Record<string, string | number | boolean | null | undefined> };

/** Keep Noted's complete JSON bodies, including sync tombstones and serverTime. */
export function createNotedClient(oxy: OxyServices, baseURL: string, timeoutMs = 10_000) {
  const linked = oxy.createLinkedClient({ baseURL });

  async function request<T>(method: Method, path: string, body?: unknown, query?: Query): Promise<{ data: T }> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query?.params ?? {})) {
      if (value !== undefined && value !== null) params.set(key, String(value));
    }
    const suffix = params.toString();
    const url = suffix ? `${path}${path.includes('?') ? '&' : '?'}${suffix}` : path;
    const controller = new AbortController();
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
      const data: unknown = text ? JSON.parse(text) : null;
      if (!response.ok) {
        const message = typeof data === 'object' && data !== null && 'error' in data && typeof data.error === 'string'
          ? data.error : `Request failed with status ${response.status}`;
        // Existing Noted callers inspect response.status (404 deletes) and data.error.
        throw Object.assign(new Error(message), { response: { status: response.status, data } });
      }
      return { data: data as T };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    get: <T = unknown>(path: string, query?: Query) => request<T>('GET', path, undefined, query),
    post: <T = unknown>(path: string, body?: unknown) => request<T>('POST', path, body),
    put: <T = unknown>(path: string, body?: unknown) => request<T>('PUT', path, body),
    patch: <T = unknown>(path: string, body?: unknown) => request<T>('PATCH', path, body),
    delete: <T = unknown>(path: string) => request<T>('DELETE', path),
    dispose: linked.dispose,
  };
}
