// Checks a downloaded logs artifact: one file per unit plus the diagnostics the action adds.
// Usage: node logs.mjs <dir> <file>...

import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const [dir, ...expected] = process.argv.slice(2);
assert.ok(dir && existsSync(dir), `artifact directory ${dir}`);
const files = readdirSync(dir);
for (const file of expected) {
  assert.ok(files.includes(file), `${file} in ${dir}: ${files.join(', ')}`);
}
assert.ok(existsSync(join(dir, 'devlanes-daemon.log')), 'the daemon log is included');
console.log(`ok: ${files.join(', ')}`);
