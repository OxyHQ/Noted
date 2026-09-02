import { appCapabilityCatalogSchema } from '@oxyhq/contracts';
import { createCatalogMcpToolDefinitions, type CatalogToolHandlers } from '@oxyhq/mcp';
import { describe, expect, it } from 'vitest';

import { NOTED_CAPABILITY_CATALOG } from '../noted.catalog.js';

describe('Noted capability catalog', () => {
  it('is valid and defines every tool exactly once', () => {
    expect(appCapabilityCatalogSchema.parse(NOTED_CAPABILITY_CATALOG)).toEqual(
      NOTED_CAPABILITY_CATALOG,
    );

    const names = NOTED_CAPABILITY_CATALOG.tools.map(({ name }) => name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('uses the same names, schemas, capabilities, and versions for MCP', () => {
    const handlers = Object.fromEntries(
      NOTED_CAPABILITY_CATALOG.tools.map(({ name }) => [
        name,
        async () => ({ structuredContent: {} }),
      ]),
    ) as CatalogToolHandlers;

    const definitions = createCatalogMcpToolDefinitions(
      NOTED_CAPABILITY_CATALOG,
      handlers,
    );
    const publicTools = NOTED_CAPABILITY_CATALOG.tools.filter(({ exposure }) =>
      exposure.includes('mcp'),
    );

    expect(definitions.map(({ tool }) => tool)).toEqual(publicTools);
  });

  it('requires idempotency keys for every effectful tool', () => {
    for (const tool of NOTED_CAPABILITY_CATALOG.tools) {
      if (tool.effect === 'read') continue;
      expect(tool.idempotency).toBe('required');
      expect(tool.inputSchema).toMatchObject({
        required: expect.arrayContaining(['idempotencyKey']),
      });
    }
  });
});
