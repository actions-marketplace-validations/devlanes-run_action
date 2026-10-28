import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { cli, parseJson, spawnProcess } from './devlanes.ts';

test('the last line of NDJSON is the result', () => {
  assert.deepEqual(parseJson('{"seq":1}\n{"lane":"acme@0"}\n', ['start']), { lane: 'acme@0' });
  assert.throws(() => parseJson('\n', ['status']), /printed no JSON/);
  assert.throws(() => parseJson('error: nope', ['status']), /something other than JSON/);
});

test('processes report their exit code and captured output', async () => {
  const result = await spawnProcess(
    process.execPath,
    ['-e', 'console.log("out"); console.error("err"); process.exit(3)'],
    { PATH: process.env.PATH ?? '' },
    {}
  );
  assert.deepEqual(result, { code: 3, stdout: 'out\n', stderr: 'err\n' });
});

test('json data is read even when the command exits 1, and stderr explains no data', async () => {
  // A script stands in for devlanes, so the trailing --json lands in its own argv.
  const dir = await mkdtemp(join(tmpdir(), 'devlanes-cli-'));
  const status = join(dir, 'status.mjs');
  const unreachable = join(dir, 'unreachable.mjs');
  await writeFile(status, 'console.log(JSON.stringify({ running: false })); process.exit(1);\n');
  await writeFile(unreachable, 'console.error("error: daemon unreachable"); process.exit(4);\n');

  const node = cli(process.execPath, { PATH: process.env.PATH ?? '' });
  assert.deepEqual(await node.json<{ running: boolean }>([status]), { running: false });
  await assert.rejects(node.json([unreachable]), /exited 4: error: daemon unreachable/);
});
