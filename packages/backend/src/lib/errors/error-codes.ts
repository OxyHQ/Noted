/**
 * Noted Error Codes & Typed Error Class
 *
 * A small, generic application error with an HTTP status and a user-safe
 * message. (The AI-provider failover error system from the previous product
 * has been removed — these codes cover ordinary REST failures only.)
 */

export type NotedErrorCode =
  | 'VALIDATION'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INTERNAL';

const DEFAULT_HTTP_STATUS: Record<NotedErrorCode, number> = {
  VALIDATION: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL: 500,
};

export interface NotedErrorParams {
  code: NotedErrorCode;
  /** User-facing message (safe to display). */
  message: string;
  httpStatus?: number;
  cause?: unknown;
}

export class NotedError extends Error {
  readonly code: NotedErrorCode;
  readonly httpStatus: number;

  constructor(params: NotedErrorParams) {
    super(params.message, { cause: params.cause });
    this.name = 'NotedError';
    this.code = params.code;
    this.httpStatus = params.httpStatus ?? DEFAULT_HTTP_STATUS[params.code];
  }
}

export function isNotedError(err: unknown): err is NotedError {
  return err instanceof NotedError;
}

/** Coerce an unknown thrown value into a NotedError (defaults to INTERNAL). */
export function toNotedError(err: unknown): NotedError {
  if (isNotedError(err)) return err;
  const message = err instanceof Error ? err.message : 'Internal server error';
  return new NotedError({ code: 'INTERNAL', message, cause: err });
}
