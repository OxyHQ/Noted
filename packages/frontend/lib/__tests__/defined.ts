/**
 * Narrows a value a test's own setup guarantees. A missing value fails here,
 * naming what was missing, instead of as a TypeError several frames later.
 */
export function defined<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`Expected ${what} to be defined`);
  return value;
}
