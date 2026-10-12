/**
 * Every built backend entrypoint must END NON-ZERO when it fails and 0 when it
 * succeeds, under Bun, the runtime the production image ships.
 *
 * Executes the BUILT artefacts the way the image and the deploy run them, from
 * the repository root with `NODE_ENV=production`:
 *   - `bun packages/backend/dist/index.js`, the image's CMD;
 *   - `bun packages/backend/dist/migrate.js`, the pre-deploy one-shot whose exit
 *     code `.github/workflows/deploy-aws.yml` reads before rolling out;
 *   - `bun packages/backend/dist/register-capability-catalog.js`, the one-shot
 *     that publishes the catalog after the rollout (and restores it on rollback).
 * Never `src/`, which is a different file from the bundle the image ships.
 *
 * An orchestrator reads only the exit code: a crashed boot or migration that
 * exits 0 reads as success. Every failure scenario asserts BOTH a non-zero exit
 * and a line proving the process reached the failure being tested, because a
 * module that cannot even load also exits non-zero and would satisfy the check
 * vacuously. The positive controls (migrations applied, a real boot answering
 * /health/ready and shutting down on SIGTERM, a catalog registered through the
 * task-role attestation) rule out "this artefact never runs" as the reason.
 *
 * Usage: `bun run build:backend && bun scripts/check-backend-entrypoints.ts`.
 * Requires `NOTED_ENTRYPOINTS_ADMIN_DATABASE_URL`: a disposable Postgres server
 * on which this script creates, and afterwards drops, its own database.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const SERVER = 'packages/backend/dist/index.js';
const MIGRATOR = 'packages/backend/dist/migrate.js';
const CATALOG = 'packages/backend/dist/register-capability-catalog.js';
// The image's runtime. Override only to compare runtimes, e.g. RUNTIME_BINARY=node.
const RUNTIME = process.env.RUNTIME_BINARY || 'bun';

interface Outcome {
  code: number | null;
  signal: NodeJS.Signals | null;
  output: string;
  timedOut: boolean;
}

interface Run {
  done: Promise<Outcome>;
  output: () => string;
  kill: (signal: NodeJS.Signals) => void;
}

function start(argv: string[], env: Record<string, string>, timeoutMs: number): Run {
  // Inherit nothing that could decide the scenario: PATH and HOME only, then
  // what the scenario sets. A developer's DATABASE_URL, REDIS_URL or Oxy
  // credential must not leak in.
  const child = spawn(RUNTIME, argv, {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      NODE_ENV: 'production',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    output += chunk;
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGKILL');
  }, timeoutMs);
  const done = new Promise<Outcome>((resolve, reject) => {
    child.on('error', reject);
    // 'close', not 'exit': 'exit' can precede the last piped chunk.
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, output, timedOut });
    });
  });
  return { done, output: () => output, kill: (signal) => child.kill(signal) };
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() =>
        typeof address === 'object' && address
          ? resolve(address.port)
          : reject(new Error('no port')),
      );
    });
  });
}

const failures: string[] = [];

function check(scenario: string, condition: boolean, message: string, outcome?: Outcome): void {
  if (condition) return;
  failures.push(`${scenario}: ${message}`);
  if (outcome) {
    console.error(`--- ${scenario}: output (last 40 lines) ---`);
    console.error(outcome.output.split('\n').slice(-40).join('\n'));
  }
}

/** A failure: non-zero, not by timeout, after reaching every `reached` line. */
async function expectFailure(
  scenario: string,
  argv: string[],
  env: Record<string, string>,
  reached: string[],
): Promise<void> {
  const outcome = await start(argv, env, 30_000).done;
  check(scenario, !outcome.timedOut, 'still running after 30 s instead of exiting', outcome);
  check(
    scenario,
    outcome.code !== 0,
    `exited with code ${outcome.code} (signal ${outcome.signal}); a failure must be non-zero`,
    outcome,
  );
  for (const line of reached) {
    check(scenario, outcome.output.includes(line), `never logged ${JSON.stringify(line)}`, outcome);
  }
  console.log(`${scenario}: exit ${outcome.code}${outcome.timedOut ? ' (timed out)' : ''}`);
}

/** A success: exit 0 after reaching every `reached` line. */
async function expectSuccess(
  scenario: string,
  argv: string[],
  env: Record<string, string>,
  reached: string[],
): Promise<void> {
  const outcome = await start(argv, env, 60_000).done;
  check(scenario, !outcome.timedOut, 'still running after 60 s', outcome);
  check(scenario, outcome.code === 0, `exited with code ${outcome.code}`, outcome);
  for (const line of reached) {
    check(scenario, outcome.output.includes(line), `never logged ${JSON.stringify(line)}`, outcome);
  }
  console.log(`${scenario}: exit ${outcome.code}`);
}

async function waitForReady(port: number, run: Run, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health/ready`);
      if (response.status === 200) return true;
    } catch {
      // not listening yet
    }
    if (run.output().includes('Failed to connect to PostgreSQL')) return false;
    await Bun.sleep(250);
  }
  return false;
}

/**
 * A stand-in for the two things the catalog one-shot talks to on ECS: the
 * container credentials endpoint behind the task role, and Oxy's workload
 * attestation and catalog routes. The attestation itself is not verified (that
 * is Oxy's side); what is exercised is that the Bun-run artefact reaches it,
 * presents the minted token and exits on the answer.
 */
function startFakeOxy(registerStatus: () => number) {
  return Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(request) {
      const { pathname } = new URL(request.url);
      if (pathname === '/credentials') {
        return Response.json({
          AccessKeyId: 'AKIAFAKEENTRYPOINT',
          SecretAccessKey: 'fake-secret',
          Token: 'fake-session',
        });
      }
      if (pathname === '/auth/service-token/workload/challenge') {
        return Response.json({ nonce: 'entrypoint-nonce' });
      }
      if (pathname === '/auth/service-token/workload') {
        const body = (await request.json()) as { nonce?: string };
        if (body.nonce !== 'entrypoint-nonce') return new Response('bad nonce', { status: 400 });
        return Response.json({ token: 'entrypoint-token', expiresIn: 3600, appName: 'noted' });
      }
      if (pathname === '/capabilities/catalogs/register') {
        if (request.headers.get('authorization') !== 'Bearer entrypoint-token') {
          return new Response('unauthenticated', { status: 401 });
        }
        const status = registerStatus();
        if (status !== 200) return new Response('refused', { status });
        return Response.json({ registration: { digest: 'sha256:entrypoint' } });
      }
      return new Response('not found', { status: 404 });
    },
  });
}

async function main(): Promise<void> {
  const adminUrl = process.env.NOTED_ENTRYPOINTS_ADMIN_DATABASE_URL;
  if (!adminUrl) {
    console.error(
      '::error::NOTED_ENTRYPOINTS_ADMIN_DATABASE_URL is required (the positive controls migrate and boot for real).',
    );
    process.exit(1);
  }
  for (const entry of [SERVER, MIGRATOR, CATALOG]) {
    if (!existsSync(join(ROOT, entry))) {
      console.error(`::error::${entry} does not exist; run \`bun run build:backend\` first.`);
      process.exit(1);
    }
  }

  const database = `noted_entrypoints_${process.pid}`;
  const databaseUrl = new URL(adminUrl);
  databaseUrl.pathname = `/${database}`;
  const admin = new Bun.SQL(adminUrl);
  await admin.unsafe(`CREATE DATABASE ${database}`);

  try {
    await scenarios(databaseUrl.toString(), database);
  } finally {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
    await admin.close();
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error(`::error::${failure}`);
    process.exit(1);
  }
  console.log(
    'Every built backend entrypoint exits non-zero on each failure tested, and 0 when it succeeds.',
  );
}

async function scenarios(databaseUrl: string, database: string): Promise<void> {
  // --- migrator -----------------------------------------------------------
  await expectFailure(
    'migrator: unrecognised --phase',
    [MIGRATOR, `--target-database=${database}`, '--phase=pre-deploy'],
    { DATABASE_URL: databaseUrl },
    ['Unrecognised --phase', 'Postgres migration failed'],
  );
  await expectFailure(
    'migrator: wrong --target-database',
    [MIGRATOR, '--target-database=noted_not_this_one', '--phase=pre'],
    { DATABASE_URL: databaseUrl },
    ['Postgres migration failed'],
  );
  // The deploy runs `pre` before the rollout and `post` deliberately after it.
  await expectSuccess(
    'migrator: pre phase',
    [MIGRATOR, `--target-database=${database}`, '--phase=pre'],
    { DATABASE_URL: databaseUrl },
    ['migration'],
  );
  await expectSuccess(
    'migrator: post phase',
    [MIGRATOR, `--target-database=${database}`, '--phase=post'],
    { DATABASE_URL: databaseUrl },
    ['phase=post'],
  );

  // --- server -------------------------------------------------------------
  // `DATABASE_URL` points at a port nothing listens on: there is no second store
  // to fall back to, so the task must refuse to start, and say why.
  const closedPort = await freePort();
  await expectFailure(
    'server: Postgres unreachable',
    [SERVER],
    {
      DATABASE_URL: `postgres://noted:noted@127.0.0.1:${closedPort}/${database}`,
      DATABASE_CONNECT_TIMEOUT_SECONDS: '2',
      PORT: String(await freePort()),
    },
    ['Failed to connect to PostgreSQL'],
  );
  // Set EMPTY rather than unset, so dotenv cannot fill it from a developer's
  // packages/backend/.env.
  await expectFailure(
    'server: DATABASE_URL missing',
    [SERVER],
    { DATABASE_URL: '', PORT: String(await freePort()) },
    ['DATABASE_URL is not set', 'Failed to connect to PostgreSQL'],
  );
  // A throw while the bundle evaluates, before anything listens.
  await expectFailure(
    'server: misspelled ecosystem activation',
    [SERVER],
    {
      DATABASE_URL: databaseUrl,
      OXY_ECOSYSTEM_ACTIVITY_ENABLED: 'tru',
      PORT: String(await freePort()),
    },
    ['OXY_ECOSYSTEM_ACTIVITY_ENABLED must be true or false'],
  );

  // Positive control: the same artefact boots against the migrated database,
  // reports ready, and a SIGTERM (what ECS sends on a rollout) ends in exit 0.
  const port = await freePort();
  const run = start([SERVER], { DATABASE_URL: databaseUrl, PORT: String(port) }, 90_000);
  const ready = await waitForReady(port, run, 30_000);
  check('server: boots and shuts down', ready, `never answered /health/ready 200 on port ${port}`);
  run.kill('SIGTERM');
  const outcome = await run.done;
  check('server: boots and shuts down', !outcome.timedOut, 'did not exit after SIGTERM', outcome);
  check(
    'server: boots and shuts down',
    outcome.code === 0,
    `a graceful shutdown exited with code ${outcome.code} (signal ${outcome.signal})`,
    outcome,
  );
  check(
    'server: boots and shuts down',
    outcome.output.includes('Graceful shutdown complete'),
    'never logged "Graceful shutdown complete"',
    outcome,
  );
  console.log(`server: boots and shuts down: ready=${ready}, exit ${outcome.code}`);

  // --- capability catalog -------------------------------------------------
  await expectFailure('catalog: no Oxy identity', [CATALOG], {}, ['Noted has no Oxy identity']);

  let registerStatus = 200;
  const oxy = startFakeOxy(() => registerStatus);
  const origin = `http://127.0.0.1:${oxy.port}`;
  // The ECS shape: no key pair, a task role to attest (oxy ADR 0026).
  const taskRole = {
    OXY_API_URL: origin,
    AWS_CONTAINER_CREDENTIALS_FULL_URI: `${origin}/credentials`,
  };
  try {
    await expectSuccess('catalog: registers through the task role', [CATALOG], taskRole, [
      'Registered Noted capability catalog',
      'sha256:entrypoint',
    ]);
    registerStatus = 503;
    await expectFailure('catalog: Oxy refuses the registration', [CATALOG], taskRole, [
      'registration failed (503)',
    ]);
  } finally {
    await oxy.stop(true);
  }
}

await main();
