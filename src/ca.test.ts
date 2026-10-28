import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { caFiles, caVariables } from './ca.ts';

/** A devlanes home with its CA files, and a scratch directory for combined files. */
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'devlanes-ca-'));
  const files = { cert: join(root, 'ca.pem'), bundle: join(root, 'bundle.pem') };
  await writeFile(files.cert, 'DEVLANES CA\n');
  await writeFile(files.bundle, 'ROOTS\nDEVLANES CA\n');
  return { root, files, dir: join(root, 'combined') };
}

test('CA files live under the home', () => {
  assert.deepEqual(caFiles(join('home', 'runner', '.devlanes')), {
    cert: join('home', 'runner', '.devlanes', 'ca', 'ca.pem'),
    bundle: join('home', 'runner', '.devlanes', 'ca', 'bundle.pem')
  });
});

test('runtimes that add to their roots get the CA and the others the bundle', async () => {
  const { files, dir } = await fixture();
  assert.deepEqual(await caVariables(files, {}, dir), {
    NODE_EXTRA_CA_CERTS: files.cert,
    DENO_CERT: files.cert,
    SSL_CERT_FILE: files.bundle,
    REQUESTS_CA_BUNDLE: files.bundle
  });
});

test('a CA the workflow already set is combined with the devlanes CA', async () => {
  const { root, files, dir } = await fixture();
  const own = join(root, 'company.pem');
  await writeFile(own, 'COMPANY CA\n');

  const variables = await caVariables(files, { NODE_EXTRA_CA_CERTS: own }, dir);
  assert.equal(variables.NODE_EXTRA_CA_CERTS, join(dir, 'NODE_EXTRA_CA_CERTS.pem'));
  assert.equal(
    await readFile(join(dir, 'NODE_EXTRA_CA_CERTS.pem'), 'utf8'),
    'COMPANY CA\nDEVLANES CA\n'
  );
  assert.equal(variables.SSL_CERT_FILE, files.bundle);
});

test('a second action step keeps the combined file and a missing file is replaced', async () => {
  const { files, dir } = await fixture();
  const combined = join(dir, 'SSL_CERT_FILE.pem');
  const variables = await caVariables(
    files,
    { SSL_CERT_FILE: combined, NODE_EXTRA_CA_CERTS: join(dir, '..', 'missing.pem') },
    dir
  );
  assert.equal(variables.SSL_CERT_FILE, combined);
  assert.equal(variables.NODE_EXTRA_CA_CERTS, files.cert);
});
