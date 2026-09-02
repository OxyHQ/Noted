import { createCatalogMcpHttpService } from '@oxyhq/mcp';

import { log } from '../lib/logger.js';
import { NOTED_CAPABILITY_CATALOG } from './noted.catalog.js';
import { NOTED_MCP_HANDLERS } from './noted.handlers.js';
import {
  invalidateOxyServiceToken,
  requiredOxyServiceToken,
} from './oxy-service-client.js';

const DEFAULT_ALLOWED_ORIGINS = [
  'https://chatgpt.com',
  'https://claude.ai',
] as const;

export function parseMcpAllowedOrigins(
  configured = process.env.MCP_ALLOWED_ORIGINS,
): string[] {
  return [...new Set([
    ...DEFAULT_ALLOWED_ORIGINS,
    ...(configured ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  ])];
}

export function createNotedMcpHttpService() {
  return createCatalogMcpHttpService({
    catalog: NOTED_CAPABILITY_CATALOG,
    handlers: NOTED_MCP_HANDLERS,
    authorizationServer: process.env.OXY_API_URL ?? 'https://api.oxy.so',
    getServiceToken: requiredOxyServiceToken,
    invalidateServiceToken: invalidateOxyServiceToken,
    allowedOrigins: parseMcpAllowedOrigins(),
    authorize: async (_input, context) => ({
      allowed: true,
      effectiveAccountId: context.principal.accountId,
    }),
    logger: {
      error(message, error) {
        log.auth.error({ err: error }, message);
      },
    },
    serverName: 'noted-mcp',
  });
}
