import { describe, expect, it } from 'vitest';

import { parseMcpAllowedOrigins } from '../noted-mcp-http.js';

describe('Noted MCP HTTP configuration', () => {
  it('keeps the supported clients and adds only exact, distinct origins', () => {
    expect(parseMcpAllowedOrigins(
      'https://example.test, https://claude.ai,https://example.test',
    )).toEqual([
      'https://chatgpt.com',
      'https://claude.ai',
      'https://example.test',
    ]);
  });
});
