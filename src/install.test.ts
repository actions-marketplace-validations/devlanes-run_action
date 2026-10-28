import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findArchive, releaseFolder, releaseTarget } from './install.ts';

const hash = 'a'.repeat(64);
const sums = [
  `${hash}  devlanes-0.6.1-aarch64-apple-darwin.tar.gz`,
  `${hash}  devlanes-0.6.1-x86_64-unknown-linux-gnu.tar.gz`,
  `${hash}  devlanes-0.6.1-x86_64-pc-windows-msvc.zip`,
  ''
].join('\n');

test('every runner OS and CPU maps to its release target', () => {
  assert.equal(releaseTarget('linux', 'x64', false).triple, 'x86_64-unknown-linux-gnu');
  assert.equal(releaseTarget('linux', 'arm64', false).triple, 'aarch64-unknown-linux-gnu');
  assert.equal(releaseTarget('darwin', 'arm64', false).triple, 'aarch64-apple-darwin');
  assert.equal(releaseTarget('darwin', 'x64', false).triple, 'x86_64-apple-darwin');
  const windows = releaseTarget('win32', 'x64', false);
  assert.equal(windows.triple, 'x86_64-pc-windows-msvc');
  assert.equal(windows.extension, '.zip');
  assert.equal(windows.executable, 'devlanes.exe');
  assert.equal(releaseTarget('win32', 'arm64', false).triple, 'aarch64-pc-windows-msvc');
});

test('runners without a build are refused with the reason', () => {
  assert.throws(() => releaseTarget('linux', 'x64', true), /need glibc/);
  assert.throws(() => releaseTarget('linux', 'ia32', false), /no release build for linux ia32/);
  assert.throws(() => releaseTarget('freebsd', 'x64', false), /no release build for freebsd/);
});

test('release folders follow the version kind', () => {
  assert.equal(releaseFolder('latest'), 'latest/download');
  assert.equal(releaseFolder('next'), 'download/next');
  assert.equal(releaseFolder('0.6.1'), 'download/v0.6.1');
});

test('the archive line names the version for latest and next', () => {
  const linux = releaseTarget('linux', 'x64', false);
  assert.deepEqual(findArchive(sums, linux, 'latest'), {
    hash,
    name: 'devlanes-0.6.1-x86_64-unknown-linux-gnu.tar.gz',
    version: '0.6.1'
  });
  const windows = findArchive(
    sums.replaceAll('\n', '\r\n'),
    releaseTarget('win32', 'x64', false),
    'next'
  );
  assert.equal(windows.name, 'devlanes-0.6.1-x86_64-pc-windows-msvc.zip');
});

test('a SHA256SUMS for another version or target is refused', () => {
  const linux = releaseTarget('linux', 'x64', false);
  assert.throws(() => findArchive(sums, linux, '0.7.0'), /lists devlanes 0.6.1, expected 0.7.0/);
  assert.throws(
    () => findArchive(sums, releaseTarget('linux', 'arm64', false), '0.6.1'),
    /No aarch64-unknown-linux-gnu archive/
  );
  assert.throws(
    () => findArchive(`abc  devlanes-0.6.1-x86_64-unknown-linux-gnu.tar.gz`, linux, '0.6.1'),
    /Malformed checksum/
  );
});
