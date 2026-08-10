/**
 * That the app mounts its own react-query client.
 *
 * A real crash, reported from a running app: `useNotificationSetup` calls
 * `useQueryClient()`, which THROWS when no provider is above it, and the app's
 * own `QueryProvider` was written and never mounted. It had been working only for
 * as long as it borrowed the client `@oxyhq/services` mounts for its own
 * internals — which is not a contract, and when it stopped holding, the symptom
 * was a white screen behind an error boundary rather than anything naming the
 * cause.
 *
 * A source check, which is crude, and scoped to the two named files. It is here
 * because nothing else can see this: the hook and the provider are both React,
 * both unreachable from a node suite, and the bug is the absence of a line.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const HERE = import.meta.dirname;
const read = (path: string): string => readFileSync(join(HERE, '..', '..', path), 'utf8');

const APP_LAYOUT = read('app/(app)/_layout.tsx');
const QUERY_CLIENT = read('lib/query-client.tsx');

/** Every module that reaches for a client and would throw without one. */
const CONSUMERS = [
  'lib/hooks/use-notification-setup.ts',
  'lib/hooks/use-notes.ts',
  'lib/hooks/use-labels.ts',
  'lib/hooks/use-notifications.ts',
  'lib/hooks/use-file-metadata.ts',
] as const;

describe('the files this checks', () => {
  it('are the files it thinks they are', () => {
    expect(APP_LAYOUT).toContain('export default function AppLayout');
    expect(QUERY_CLIENT).toContain('export function QueryProvider');
  });

  it('finds the consumers that make this necessary', () => {
    // Without a floor, deleting every consumer would make the assertion below
    // pass by having nothing left to protect.
    const reaching = CONSUMERS.filter((path) =>
      /useQueryClient|useQuery|useMutation|useInfiniteQuery/.test(read(path)),
    );
    expect(reaching.length).toBeGreaterThan(0);
  });
});

describe('the provider', () => {
  it('is mounted, not merely defined', () => {
    // The whole bug in one assertion.
    expect(APP_LAYOUT).toContain('<QueryProvider>');
    expect(APP_LAYOUT).toContain("from \"@/lib/query-client\"");
  });

  it('is above the hooks that need it, not beside them', () => {
    // A provider cannot serve the component that renders it, so the hooks had to
    // move into a child. If they move back, this goes red.
    const providerAt = APP_LAYOUT.indexOf('<QueryProvider>');
    const hookAt = APP_LAYOUT.indexOf('useNotificationSetup()');
    expect(providerAt).toBeGreaterThanOrEqual(0);
    expect(hookAt).toBeGreaterThan(providerAt);
    expect(APP_LAYOUT).toContain('function AppLayoutContent');
  });
});
