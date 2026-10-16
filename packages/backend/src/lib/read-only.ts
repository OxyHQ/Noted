import type { RequestHandler } from 'express';

/**
 * Noted's notes moved to Nilo (`api.nilo.so`, the personal workspace's notes
 * database); this server only answers app builds from before the move. They
 * may still read, so they keep showing what they have, but a write is refused
 * rather than landing in a database nothing reads any more: those builds keep
 * it on the device as unsent and deliver it to Nilo once they are updated.
 */
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const MOVED_TO_NILO = {
  error: 'Noted moved to Nilo. Update the app to keep syncing.',
  code: 'MOVED_TO_NILO',
} as const;

export const refuseWrites: RequestHandler = (req, res, next) => {
  if (READ_METHODS.has(req.method)) {
    next();
    return;
  }
  res.status(503).set('Retry-After', '86400').json(MOVED_TO_NILO);
};
