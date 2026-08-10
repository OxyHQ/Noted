/**
 * Drizzle schema barrel.
 *
 * This file is BOTH the single entry point `drizzle.config.ts` generates
 * migrations from AND the object `db/postgres.ts` hands to drizzle for the typed
 * query API. A table that is not re-exported here is invisible to both, so it
 * gets neither a migration nor a typed query — which is the failure mode to
 * remember when a new table "does not exist" against a database you just
 * migrated.
 *
 * Add one line per table module. Keep the order a DEPENDENCY order once tables
 * start referencing each other.
 */
export * from './notes.js';
export * from './labels.js';
export * from './feedback.js';
export * from './notifications.js';
export * from './pushTokens.js';
export * from './note-artifacts.js';
