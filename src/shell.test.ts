import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scriptText, shellArgv } from './shell.ts';

test('each shell gets the flags GitHub passes it', () => {
  assert.deepEqual(shellArgv('bash', '/tmp/s.sh', 'linux'), [
    'bash',
    '--noprofile',
    '--norc',
    '-eo',
    'pipefail',
    '/tmp/s.sh'
  ]);
  assert.deepEqual(shellArgv('sh', '/tmp/s.sh', 'linux'), ['sh', '-e', '/tmp/s.sh']);
  assert.deepEqual(shellArgv('pwsh', 'D:\\a\\_temp\\s.ps1', 'win32'), [
    'pwsh',
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    ". 'D:\\a\\_temp\\s.ps1'"
  ]);
  assert.deepEqual(shellArgv('cmd', 'D:\\a\\_temp\\s.cmd', 'win32'), [
    'cmd',
    '/D',
    '/E:ON',
    '/V:OFF',
    '/C',
    'CALL',
    'D:\\a\\_temp\\s.cmd'
  ]);
});

test('quotes in a PowerShell script path are escaped for the -Command string', () => {
  assert.equal(shellArgv('powershell', "C:\\it's\\s.ps1", 'win32').at(-1), ". 'C:\\it''s\\s.ps1'");
});

test('PowerShell scripts stop on errors and exit with the last native code', () => {
  const text = scriptText('pwsh', 'pnpm test');
  assert.match(text, /^\$ErrorActionPreference = 'stop'\npnpm test\n/);
  assert.match(text, /exit \$LASTEXITCODE/);
});

test('cmd scripts use CRLF and other scripts end with a newline', () => {
  assert.equal(scriptText('cmd', 'echo a\necho b'), 'echo a\r\necho b\r\n');
  assert.equal(scriptText('bash', 'pnpm test'), 'pnpm test\n');
  assert.equal(scriptText('sh', 'pnpm test\n'), 'pnpm test\n');
});
