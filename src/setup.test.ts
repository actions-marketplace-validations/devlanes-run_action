import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Devlanes, RunResult } from './devlanes.ts';
import { applyConfig, daemonStatus, flattenConfig } from './setup.ts';

/** A devlanes CLI that records its calls and answers from `answer`. */
function fake(answer: (args: string[]) => RunResult) {
  const calls: string[][] = [];
  const devlanes: Devlanes = {
    run: async (args) => {
      calls.push(args);
      return answer(args);
    },
    json: async () => {
      throw new Error('not used');
    }
  };
  return { devlanes, calls };
}

test('the config input becomes dotted settings', () => {
  const changes = flattenConfig(
    'proxy:\n  https_port: 9443\ntls:\n  trust: [system, chrome]\nlanes:\n  freeze_after: 30m\n  data_dir: ~\n'
  );
  assert.deepEqual(changes, [
    { key: 'proxy.https_port', value: '9443' },
    { key: 'tls.trust', value: '["system","chrome"]' },
    { key: 'lanes.freeze_after', value: '30m' },
    { key: 'lanes.data_dir', value: null }
  ]);
  assert.deepEqual(flattenConfig('  \n'), []);
  assert.throws(() => flattenConfig('- a\n- b\n'), /must be a YAML mapping/);
});

test('settings are applied with config set, nulls with config unset', async () => {
  const { devlanes, calls } = fake(() => ({ code: 0, stdout: '', stderr: '' }));
  await applyConfig(devlanes, [
    { key: 'startup.mode', value: 'all' },
    { key: 'lanes.data_dir', value: null }
  ]);
  assert.deepEqual(calls, [
    ['config', 'set', 'startup.mode', 'all'],
    ['config', 'unset', 'lanes.data_dir']
  ]);
});

test('a setting devlanes refuses fails with its message', async () => {
  const { devlanes } = fake(() => ({
    code: 2,
    stdout: '',
    stderr: 'error: unknown key proxy.nope'
  }));
  await assert.rejects(
    applyConfig(devlanes, [{ key: 'proxy.nope', value: '1' }]),
    /unknown key proxy\.nope/
  );
});

test('daemon status names the home whether or not a daemon runs', async () => {
  const stopped = fake(() => ({
    code: 1,
    stdout: '{"running":false,"socket":"x","home":"/home/runner/.devlanes"}\n',
    stderr: ''
  }));
  assert.deepEqual(await daemonStatus(stopped.devlanes), {
    running: false,
    home: '/home/runner/.devlanes'
  });

  const running = fake(() => ({
    code: 0,
    stdout: '{"running":true,"user_config":{"path":"/home/runner/.devlanes/config.yaml"}}\n',
    stderr: ''
  }));
  assert.deepEqual(await daemonStatus(running.devlanes), {
    running: true,
    home: '/home/runner/.devlanes'
  });
});
