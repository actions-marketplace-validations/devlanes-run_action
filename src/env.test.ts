import assert from 'node:assert/strict';
import { test } from 'node:test';
import { childEnv } from './env.ts';

test('action plumbing stays out of devlanes and the services it starts', () => {
  const env = childEnv(
    {
      PATH: '/usr/bin',
      DATABASE_URL: 'postgres://example.invalid/app',
      INPUT_RUN: 'pnpm test',
      'INPUT_WORKING-DIRECTORY': 'apps',
      STATE_devlanes: '{}',
      ACTIONS_RUNTIME_TOKEN: 'secret',
      ACTIONS_RESULTS_URL: 'https://results.example.invalid',
      ACTIONS_ID_TOKEN_REQUEST_URL: 'https://token.example.invalid',
      GITHUB_ACTIONS: 'true',
      UNSET: undefined
    },
    ''
  );
  assert.deepEqual(env, {
    PATH: '/usr/bin',
    DATABASE_URL: 'postgres://example.invalid/app',
    // run steps get the OIDC request variables too, so services may as well.
    ACTIONS_ID_TOKEN_REQUEST_URL: 'https://token.example.invalid',
    GITHUB_ACTIONS: 'true',
    DEVLANES_OUTPUT: 'plain',
    DEVLANES_AGENT: '0',
    DEVLANES_NO_UI: '1'
  });
});

test('the home input becomes DEVLANES_HOME', () => {
  assert.equal(childEnv({}, '/tmp/devlanes').DEVLANES_HOME, '/tmp/devlanes');
  assert.equal(childEnv({ DEVLANES_HOME: '/kept' }, '').DEVLANES_HOME, '/kept');
});

test('an agent marker in the job does not switch the CLI to agent output', () => {
  const env = childEnv({ CLAUDECODE: '1', DEVLANES_OUTPUT: 'agent' }, '');
  assert.equal(env.DEVLANES_OUTPUT, 'plain');
  assert.equal(env.DEVLANES_AGENT, '0');
});
