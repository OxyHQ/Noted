/**
 * Durable receipts for effectful catalog tool calls.
 *
 * A caller may retry after losing a response. The unique account/tool/key tuple
 * lets the capability runtime return the original result without applying the
 * domain mutation twice. The request digest also prevents one key from being
 * reused for different input.
 */

import { index, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { createdAt, generatedId } from '@oxyhq/db';

export const capabilityExecutions = pgTable(
  'capability_executions',
  {
    id: generatedId(),
    oxyUserId: text().notNull(),
    tool: text().notNull(),
    idempotencyKey: text().notNull(),
    requestDigest: text().notNull(),
    result: jsonb().$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('capability_executions_account_tool_key').on(
      table.oxyUserId,
      table.tool,
      table.idempotencyKey,
    ),
    index('capability_executions_created_at_idx').on(table.createdAt),
  ],
);

export type CapabilityExecutionRow = typeof capabilityExecutions.$inferSelect;
