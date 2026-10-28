import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { defaultArtifactName, filesUnder, laneLogsDir, shouldUpload } from './logs.ts';

test('each lane gets its own logs folder under the runner temp', () => {
  assert.equal(
    laneLogsDir({ RUNNER_TEMP: join('tmp') }, 'acme@0'),
    join('tmp', 'devlanes-logs', 'acme_0')
  );
  assert.equal(laneLogsDir({ RUNNER_TEMP: join('tmp') }, ''), join('tmp', 'devlanes-logs', 'lane'));
});

test('upload modes', () => {
  assert.equal(shouldUpload('always', false), true);
  assert.equal(shouldUpload('on-failure', false), false);
  assert.equal(shouldUpload('on-failure', true), true);
  assert.equal(shouldUpload('never', true), false);
});

test('default artifact names tell matrix jobs and lanes apart', () => {
  assert.equal(
    defaultArtifactName({ GITHUB_JOB: 'e2e' }, 'start on macos-latest', 'acme@0'),
    'devlanes-logs-start-on-macos-latest-acme-0'
  );
  assert.equal(
    defaultArtifactName({ GITHUB_JOB: 'e2e' }, 'E2E (ubuntu-latest, 2/4)', ''),
    'devlanes-logs-e2e-ubuntu-latest-2-4'
  );
  // Without the display name, the runner's name keeps the jobs of a matrix apart.
  assert.equal(
    defaultArtifactName(
      { GITHUB_JOB: 'e2e', RUNNER_NAME: 'GitHub Actions 1000123' },
      null,
      'acme@0'
    ),
    'devlanes-logs-e2e-github-actions-1000123-acme-0'
  );
  assert.equal(defaultArtifactName({}, null, ''), 'devlanes-logs-job');
});

test('files under a directory include nested ones, and a missing directory has none', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'devlanes-logs-'));
  await writeFile(join(dir, 'unit-api.log'), 'ready\n');
  await mkdir(join(dir, 'nested'));
  await writeFile(join(dir, 'nested', 'infra-db.log'), 'ok\n');
  assert.deepEqual(filesUnder(dir).sort(), [
    join(dir, 'nested', 'infra-db.log'),
    join(dir, 'unit-api.log')
  ]);
  assert.deepEqual(filesUnder(join(dir, 'missing')), []);
});
