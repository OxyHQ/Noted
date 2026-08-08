import { Router } from 'express';

import { assertMigrationsCurrent, checkPostgresHealth } from '../db/postgres.js';
import { getRedisClient } from '../lib/redis.js';
import { log } from '../lib/logger.js';

const router = Router();

// ============== HEALTH STATE CACHE ==============
// Avoid recomputing the snapshot on every probe.

interface HealthSnapshot {
  status: 'healthy' | 'degraded';
  timestamp: string;
  uptime: number;
  database: 'connected' | 'unavailable';
  redis: 'connected' | 'unavailable';
  memory: { rss: number; heapUsed: number; heapTotal: number };
}

let healthCache: { data: HealthSnapshot; expiry: number } | null = null;
const HEALTH_CACHE_TTL_MS = 10_000;
const BYTES_PER_MB = 1024 * 1024;

async function getHealthSnapshot(): Promise<HealthSnapshot> {
  if (healthCache && healthCache.expiry > Date.now()) {
    return healthCache.data;
  }

  // A real round trip, not a "is the pool constructed" flag: a pool can exist
  // while the server behind it is unreachable, and the cheap synchronous answer
  // is the one that reports healthy during an outage.
  const databaseOk = await checkPostgresHealth();
  const mem = process.memoryUsage();

  const snapshot: HealthSnapshot = {
    status: databaseOk ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime: Math.round(process.uptime()),
    database: databaseOk ? 'connected' : 'unavailable',
    redis: getRedisClient() ? 'connected' : 'unavailable',
    memory: {
      rss: Math.round(mem.rss / BYTES_PER_MB),
      heapUsed: Math.round(mem.heapUsed / BYTES_PER_MB),
      heapTotal: Math.round(mem.heapTotal / BYTES_PER_MB),
    },
  };

  healthCache = { data: snapshot, expiry: Date.now() + HEALTH_CACHE_TTL_MS };
  return snapshot;
}

// Full health check with details
router.get('/', async (_req, res) => {
  try {
    const snapshot = await getHealthSnapshot();
    res.status(snapshot.status === 'healthy' ? 200 : 503).json(snapshot);
  } catch (error: unknown) {
    log.general.error({ err: error }, 'Health check failed');
    res.status(503).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      uptime: Math.round(process.uptime()),
    });
  }
});

// Liveness probe: process is running -> 200
// Used to detect crashed processes.
router.get('/live', (_req, res) => {
  res.status(200).json({ status: 'alive' });
});

// Readiness probe: the database answers AND this build's migrations are applied.
//
// The migration half exists for a failure that lands after the point of no
// return: a deploy migrates in a one-shot task, and if that task did not run —
// or ran against the wrong database — the serving tasks still start, still
// connect, and then fail every query against a schema that is not there. A task
// that cannot serve correctly must not be able to say that it can.
router.get('/ready', async (_req, res) => {
  if (!(await checkPostgresHealth())) {
    return res.status(503).json({ status: 'not_ready', reason: 'database_unavailable' });
  }
  try {
    await assertMigrationsCurrent();
  } catch (error: unknown) {
    log.general.error({ err: error }, 'Readiness failed: migrations are not current');
    return res.status(503).json({ status: 'not_ready', reason: 'migrations_pending' });
  }
  res.status(200).json({ status: 'ready' });
});

export default router;
