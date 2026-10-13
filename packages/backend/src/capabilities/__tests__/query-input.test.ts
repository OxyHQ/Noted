import { jsonObjectSchemaToZod } from '@oxy.so/mcp';
import { describe, expect, it } from 'bun:test';

import { NOTED_CAPABILITY_CATALOG } from '../noted.catalog.js';
import { queryInputFor } from '../query-input.js';

const getTool = (name: string) => {
  const tool = NOTED_CAPABILITY_CATALOG.tools.find((t) => t.name === name);
  if (!tool) throw new Error(`no tool ${name}`);
  return tool;
};

describe('queryInputFor', () => {
  it('decodes the numeric and boolean inputs a query string can only carry as text', () => {
    const tool = getTool('searchNotes');
    const parse = jsonObjectSchemaToZod(tool.inputSchema);

    expect(parse.safeParse({ limit: '20' }).success).toBe(false);
    expect(parse.safeParse(queryInputFor(tool, { limit: '20' })).success).toBe(true);
  });

  it('decodes a boolean property and leaves strings alone', () => {
    const tool = getTool('searchNotes');
    const decoded = queryInputFor(tool, { pinned: 'true', query: '42', view: 'active' });
    expect(decoded).toEqual({ pinned: true, query: '42', view: 'active' });
  });

  it('leaves a value that is not exactly that type for the schema to refuse', () => {
    const tool = getTool('searchNotes');
    const parse = jsonObjectSchemaToZod(tool.inputSchema);
    const decoded = queryInputFor(tool, { limit: 'many', pinned: 'yes' });
    expect(decoded).toEqual({ limit: 'many', pinned: 'yes' });
    expect(parse.safeParse(decoded).success).toBe(false);
  });
});
