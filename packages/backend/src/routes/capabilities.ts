import { createHash } from 'node:crypto';
import { Router, type RequestHandler } from 'express';
import type { CapabilityTicketClaims, CatalogTool } from '@oxyhq/contracts';
import {
  CapabilityTicketError,
  inputSatisfiesCapabilityLimits,
  readCapabilityAuthorization,
} from '@oxyhq/core/server';
import { jsonObjectSchemaToZod } from '@oxyhq/mcp';

import {
  IdempotencyConflictError,
} from '../capabilities/capability-idempotency.js';
import {
  auditNotedCapabilityTicket,
  introspectNotedCapabilityTicket,
  verifyNotedCapabilityTicket,
} from '../capabilities/capability-authority.js';
import {
  executeNotedCatalogTool,
  NotedCapabilityError,
} from '../capabilities/noted.handlers.js';
import { NOTED_CAPABILITY_CATALOG } from '../capabilities/noted.catalog.js';
import { log } from '../lib/logger.js';

const router = Router();

function resourceMatches(
  claims: CapabilityTicketClaims,
  tool: CatalogTool,
  input: Readonly<Record<string, unknown>>,
): boolean {
  const resource = claims.resource;
  if (resource.appId !== NOTED_CAPABILITY_CATALOG.appId) return false;
  if (!tool.resourceTypes.includes(resource.resourceType)) return false;
  if (resource.resourceType === NOTED_CAPABILITY_CATALOG.accountResourceType) {
    return resource.resourceId === resource.effectiveAccountId;
  }
  if (resource.resourceType === 'note') return input.noteId === resource.resourceId;
  if (resource.resourceType === 'label') return input.labelId === resource.resourceId;
  return false;
}

function registerRoute(tool: CatalogTool, handler: RequestHandler): void {
  const path = `/${tool.name}`;
  switch (tool.invocation.method) {
    case 'GET': router.get(path, handler); break;
    case 'POST': router.post(path, handler); break;
    case 'PATCH': router.patch(path, handler); break;
    case 'PUT': router.put(path, handler); break;
    case 'DELETE': router.delete(path, handler); break;
  }
}

for (const tool of NOTED_CAPABILITY_CATALOG.tools.filter(({ exposure }) =>
  exposure.includes('internal'),
)) {
  const parseInput = jsonObjectSchemaToZod(tool.inputSchema);
  const parseOutput = tool.outputSchema ? jsonObjectSchemaToZod(tool.outputSchema) : null;

  registerRoute(tool, async (request, response) => {
    const ticket = readCapabilityAuthorization(request.header('authorization'));
    if (!ticket) {
      response.status(401).json({ error: 'capability_ticket_required' });
      return;
    }

    let claims: CapabilityTicketClaims;
    try {
      claims = await verifyNotedCapabilityTicket(ticket);
    } catch (error) {
      const code = error instanceof CapabilityTicketError ? error.code : 'jwks_unavailable';
      response.status(code === 'jwks_unavailable' ? 503 : 401).json({
        error: code === 'jwks_unavailable'
          ? 'capability_authority_unavailable'
          : 'invalid_capability_ticket',
        code,
      });
      return;
    }

    const rawInput = tool.invocation.method === 'GET' ? request.query : request.body;
    const parsedInput = parseInput.safeParse(rawInput);
    if (!parsedInput.success) {
      response.status(400).json({ error: 'capability_input_schema_mismatch' });
      return;
    }
    const input = parsedInput.data as Record<string, unknown>;
    const capabilityMatches = tool.requiredCapabilities.every((required) =>
      claims.capabilities.includes(required),
    );
    if (
      claims.tool !== tool.name
      || !capabilityMatches
      || !resourceMatches(claims, tool, input)
    ) {
      void auditNotedCapabilityTicket({
        ticket,
        result: { status: 'denied', code: 'capability_scope_mismatch' },
        rollbackSupported: tool.rollback === 'supported',
      }).catch((error: unknown) => {
        log.auth.error({ err: error, ticketId: claims.jti }, 'Capability denial audit failed');
      });
      response.status(403).json({ error: 'capability_scope_mismatch' });
      return;
    }
    if (!inputSatisfiesCapabilityLimits(tool.name, input, claims.limits)) {
      void auditNotedCapabilityTicket({
        ticket,
        result: { status: 'denied', code: 'capability_limit_exceeded' },
        rollbackSupported: tool.rollback === 'supported',
      }).catch((error: unknown) => {
        log.auth.error({ err: error, ticketId: claims.jti }, 'Capability limit audit failed');
      });
      response.status(403).json({ error: 'capability_limit_exceeded' });
      return;
    }

    try {
      if (!await introspectNotedCapabilityTicket(ticket, claims)) {
        response.status(403).json({ error: 'capability_revoked_or_denied' });
        return;
      }
    } catch (error) {
      log.auth.error({ err: error, ticketId: claims.jti }, 'Capability introspection failed');
      response.status(503).json({ error: 'capability_authority_unavailable' });
      return;
    }

    const rawIdempotencyKey = typeof input.idempotencyKey === 'string'
      ? input.idempotencyKey
      : undefined;
    const idempotencyKeyHash = rawIdempotencyKey
      ? createHash('sha256').update(rawIdempotencyKey).digest('hex')
      : undefined;

    try {
      const result = await executeNotedCatalogTool(
        tool.name,
        input,
        claims.resource.effectiveAccountId,
      );
      const output = parseOutput ? parseOutput.parse(result) : result;
      await auditNotedCapabilityTicket({
        ticket,
        result: { status: 'succeeded' },
        rollbackSupported: tool.rollback === 'supported',
        idempotencyKeyHash,
      }).catch((error: unknown) => {
        log.auth.error({ err: error, ticketId: claims.jti }, 'Capability success audit failed');
      });
      response.json(output);
    } catch (error) {
      const status = error instanceof NotedCapabilityError
        ? error.status
        : error instanceof IdempotencyConflictError
          ? 409
          : 500;
      const code = error instanceof NotedCapabilityError
        ? error.code
        : error instanceof IdempotencyConflictError
          ? 'idempotency_conflict'
          : 'capability_execution_failed';
      await auditNotedCapabilityTicket({
        ticket,
        result: { status: 'failed', code },
        rollbackSupported: tool.rollback === 'supported',
        idempotencyKeyHash,
      }).catch((auditError: unknown) => {
        log.auth.error({ err: auditError, ticketId: claims.jti }, 'Capability failure audit failed');
      });
      if (status === 500) {
        log.notes.error({ err: error, ticketId: claims.jti, tool: tool.name }, 'Capability execution failed');
      }
      response.status(status).json({ error: code });
    }
  });
}

export default router;
