/**
 * Noted Error System
 *
 * Generic typed error class + user-facing sanitization helpers.
 */

export {
  NotedError,
  isNotedError,
  toNotedError,
  type NotedErrorCode,
  type NotedErrorParams,
} from './error-codes.js';

export {
  sanitizeMessage,
  sanitizeError,
  getSafeErrorMessage,
} from './sanitize.js';
