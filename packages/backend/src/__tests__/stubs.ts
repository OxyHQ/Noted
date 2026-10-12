/**
 * `vi.stubEnv` / `vi.stubGlobal` for `bun test`, which has neither.
 *
 * Each stub records the value it replaced the first time a name is stubbed, and
 * the matching `unstubAll*` puts every one of them back. `undefined` deletes an
 * environment variable, as `vi.stubEnv(name, undefined)` did.
 */

const originalEnv = new Map<string, string | undefined>();
const originalGlobals = new Map<string, PropertyDescriptor | undefined>();

export function stubEnv(name: string, value: string | undefined): void {
  if (!originalEnv.has(name)) originalEnv.set(name, process.env[name]);
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

export function unstubAllEnvs(): void {
  for (const [name, value] of originalEnv) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  originalEnv.clear();
}

export function stubGlobal(name: string, value: unknown): void {
  if (!originalGlobals.has(name)) {
    originalGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  }
  Object.defineProperty(globalThis, name, {
    value,
    writable: true,
    configurable: true,
    enumerable: true,
  });
}

export function unstubAllGlobals(): void {
  for (const [name, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete (globalThis as Record<string, unknown>)[name];
  }
  originalGlobals.clear();
}
