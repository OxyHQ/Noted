import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';

import { getDb, type Transaction } from '../db/postgres.js';
import { capabilityExecutions } from '../db/schema/capability-executions.js';

export class IdempotencyConflictError extends Error {
  constructor() {
    super('The idempotency key was already used with different input');
    this.name = 'IdempotencyConflictError';
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

export function digestCapabilityInput(input: Readonly<Record<string, unknown>>): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(input)))
    .digest('hex');
}

export interface IdempotentExecutionResult<Result extends Record<string, unknown>> {
  result: Result;
  replayed: boolean;
}

/**
 * Apply one effectful catalog call exactly once per account/tool/key tuple.
 *
 * The transaction-scoped advisory lock closes the race between lookup and
 * mutation. The receipt is committed in the same transaction as the domain
 * write, so a crash cannot persist only one side.
 */
export async function executeIdempotently<Result extends Record<string, unknown>>(input: {
  accountId: string;
  tool: string;
  idempotencyKey: string;
  request: Readonly<Record<string, unknown>>;
  execute: (transaction: Transaction) => Promise<Result>;
}): Promise<IdempotentExecutionResult<Result>> {
  const requestDigest = digestCapabilityInput(input.request);
  const lockIdentity = JSON.stringify([input.accountId, input.tool, input.idempotencyKey]);

  return getDb().transaction(async (transaction) => {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${lockIdentity}, 0))`,
    );

    const [existing] = await transaction
      .select({
        requestDigest: capabilityExecutions.requestDigest,
        result: capabilityExecutions.result,
      })
      .from(capabilityExecutions)
      .where(and(
        eq(capabilityExecutions.oxyUserId, input.accountId),
        eq(capabilityExecutions.tool, input.tool),
        eq(capabilityExecutions.idempotencyKey, input.idempotencyKey),
      ));

    if (existing) {
      if (existing.requestDigest !== requestDigest) throw new IdempotencyConflictError();
      return { result: existing.result as Result, replayed: true };
    }

    const result = await input.execute(transaction);
    await transaction.insert(capabilityExecutions).values({
      oxyUserId: input.accountId,
      tool: input.tool,
      idempotencyKey: input.idempotencyKey,
      requestDigest,
      result,
    });
    return { result, replayed: false };
  });
}
