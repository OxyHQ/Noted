/**
 * Runtime secrets live in SSM Parameter Store, and no workflow writes one.
 *
 * Until 2026-10-10 `deploy-aws.yml` copied GitHub repo secrets into SSM on
 * every deploy, which made GitHub the source of truth for production
 * credentials: whoever could edit a repo secret could change what production
 * ran with, and every value lived in two systems. It also wrote
 * `/oxy/_shared/AWS_ACCESS_KEY_ID`, `/oxy/_shared/AWS_SECRET_ACCESS_KEY` and
 * `/oxy/_shared/REDIS_URL`, which oxy-infra owns and no app may write. SSM
 * (`/oxy/noted/*`, SecureString) is now the only source; a value is set or
 * rotated with `aws ssm put-parameter --overwrite` by its owner (oxy-infra
 * docs/runbooks/46-app-secrets-in-ssm.md), never by a workflow.
 *
 * Every workflow is read, not only the deploy: the property is "GitHub holds no
 * app runtime secret", and a second workflow reading one would break it as
 * surely as the deploy. Each half can regress alone, so both are asserted.
 * `toJSON(secrets)` stays prohibited by name: besides reading every secret, it
 * is the shape GitHub's malicious-workflow detection matches, which holds every
 * run at `action_required` with zero jobs until a human approves it.
 *
 * Text assertions rather than a YAML parse, on purpose: comment lines are
 * dropped first, so the explanation in the workflow cannot trip them, and no
 * parser dependency is needed for a property this simple.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** The repo root, from this file: `packages/backend/src/__tests__` is four deep. */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const WORKFLOWS_DIR = join(REPO_ROOT, '.github', 'workflows');

/** What CI itself spends. Nothing here is read by the running service. */
const CI_ONLY_SECRETS = [
  'ADD_TO_PROJECT_TOKEN',
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_API_TOKEN',
  'GITHUB_TOKEN',
  'NPM_TOKEN',
];

const workflows = readdirSync(WORKFLOWS_DIR)
  .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
  .map((file) => {
    const source = readFileSync(join(WORKFLOWS_DIR, file), 'utf8');
    const executable = source
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n');
    return { file, executable };
  });

const secretsReadBy = (executable: string): string[] =>
  [...executable.matchAll(/\bsecrets\.([A-Za-z0-9_]+)/g)].map((match) => match[1]);

describe('runtime secrets come from SSM, and no workflow writes one', () => {
  it('reads every workflow, including the deploy', () => {
    // Vacuity floor: an empty or misdirected directory read would make every
    // assertion below pass against nothing.
    expect(workflows.map(({ file }) => file)).toContain('deploy-aws.yml');
    const deploy = workflows.find(({ file }) => file === 'deploy-aws.yml');
    expect(deploy?.executable).toContain('aws ecs register-task-definition');
  });

  it('never writes an SSM parameter', () => {
    for (const { file, executable } of workflows) {
      expect(executable, `${file} writes SSM`).not.toMatch(/ssm\s+put-parameter/);
      expect(executable, `${file} writes a shared parameter`).not.toMatch(
        /--name\s+["']?\/oxy\/_shared\//,
      );
    }
  });

  it('never enumerates the whole secrets context', () => {
    for (const { file, executable } of workflows) {
      expect(executable, file).not.toMatch(/\$\{\{[^}]*toJSON\s*\(\s*secrets\s*\)/);
    }
  });

  it('reads no repo secret outside the CI-only allowlist', () => {
    const named = workflows.flatMap(({ executable }) => secretsReadBy(executable));
    expect(named.length, 'no secret is read anywhere, so the matcher measures nothing').toBeGreaterThan(0);
    for (const name of new Set(named)) {
      expect(CI_ONLY_SECRETS, `a workflow reads app secret ${name} from GitHub`).toContain(name);
    }
  });

  it('reads no GitHub secret at all in the deploy', () => {
    const deploy = workflows.find(({ file }) => file === 'deploy-aws.yml');
    expect(secretsReadBy(deploy?.executable ?? '')).toEqual([]);
  });
});
