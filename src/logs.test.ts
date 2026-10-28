import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  artifactNames,
  defaultArtifactName,
  filesUnder,
  isNameTaken,
  shouldUpload
} from './logs.ts';

test('upload modes', () => {
  assert.equal(shouldUpload('always', false), true);
  assert.equal(shouldUpload('on-failure', false), false);
  assert.equal(shouldUpload('on-failure', true), true);
  assert.equal(shouldUpload('never', true), false);
});

test('artifact names start from the job id and take a free suffix', () => {
  assert.equal(defaultArtifactName({ GITHUB_JOB: 'e2e' }), 'devlanes-logs-e2e');
  assert.equal(defaultArtifactName({}), 'devlanes-logs-job');
  assert.deepEqual(artifactNames('logs').slice(0, 3), ['logs', 'logs-2', 'logs-3']);
  assert.equal(artifactNames('logs').at(-1), 'logs-9');
});

test('a taken name is told apart from other upload errors', () => {
  assert.equal(
    isNameTaken(
      new Error(
        'Received non-retryable error: Failed request: (409) Conflict: an artifact with this name already exists on the workflow run'
      )
    ),
    true
  );
  assert.equal(isNameTaken(new Error('Failed request: (500) Internal Server Error')), false);
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
