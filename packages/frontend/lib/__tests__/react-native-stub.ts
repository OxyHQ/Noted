/**
 * Stands in for `react-native` under vitest.
 *
 * The real package's entry point is Flow, not TypeScript (`import typeof * as …`),
 * which Vite cannot parse — so a module that merely reads `Platform.OS` is
 * unreachable from a node test unless the import is replaced. `vi.mock` is not
 * enough: Vite still transforms the real file while resolving it.
 *
 * Only the surface the tests actually touch is stubbed. `Platform.OS` defaults to
 * `ios`; a test that cares sets it through `vi.doMock` with its own value.
 */
export const Platform = {
  OS: 'ios' as string,
  select: <T,>(specifics: Record<string, T>): T | undefined =>
    specifics.ios ?? specifics.native ?? specifics.default,
};
