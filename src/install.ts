// Installs devlanes from its GitHub release, the same archives and checksums that install.sh
// and install.ps1 use, through the runner's tool cache so self-hosted runners download once.

import { createHash, randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as core from '@actions/core';
import * as tc from '@actions/tool-cache';

export const releasesUrl = 'https://github.com/devlanes-run/devlanes/releases';

/** The release build for one OS and CPU. */
export interface Target {
  triple: string;
  extension: '.tar.gz' | '.zip';
  executable: string;
}

/** One archive line of a release's SHA256SUMS. */
export interface Archive {
  hash: string;
  name: string;
  version: string;
}

/** An installed devlanes. */
export interface Installed {
  version: string;
  bin: string;
}

/** The release target for this runner, or an error naming what has no build. */
export function releaseTarget(platform: NodeJS.Platform, arch: string, musl: boolean): Target {
  const cpu = arch === 'x64' ? 'x86_64' : arch === 'arm64' ? 'aarch64' : undefined;
  if (!cpu) throw new Error(`devlanes has no release build for ${platform} ${arch}`);

  switch (platform) {
    case 'linux':
      if (musl) throw new Error('devlanes Linux builds need glibc; this runner uses musl');
      return { triple: `${cpu}-unknown-linux-gnu`, extension: '.tar.gz', executable: 'devlanes' };
    case 'darwin':
      return { triple: `${cpu}-apple-darwin`, extension: '.tar.gz', executable: 'devlanes' };
    case 'win32':
      return { triple: `${cpu}-pc-windows-msvc`, extension: '.zip', executable: 'devlanes.exe' };
    default:
      throw new Error(`devlanes has no release build for ${platform}`);
  }
}

/** Where a release's files are downloaded from: its tag, the rolling `next`, or the latest. */
export function releaseFolder(version: string): string {
  if (version === 'latest') return 'latest/download';
  if (version === 'next') return 'download/next';
  return `download/v${version}`;
}

/**
 * Finds this target's archive in a SHA256SUMS text. The latest and `next` releases are only
 * known through it, since the archive name carries the version.
 */
export function findArchive(sums: string, target: Target, expected: string): Archive {
  const suffix = `-${target.triple}${target.extension}`;
  for (const line of sums.split(/\r?\n/)) {
    const [hash, name, ...rest] = line.trim().split(/\s+/);
    if (!hash || !name || rest.length > 0) continue;
    if (!name.startsWith('devlanes-') || !name.endsWith(suffix)) continue;

    const version = name.slice('devlanes-'.length, -suffix.length);
    if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
      throw new Error(`Unexpected version ${version} in SHA256SUMS`);
    }
    if (expected !== 'latest' && expected !== 'next' && version !== expected) {
      throw new Error(`SHA256SUMS lists devlanes ${version}, expected ${expected}`);
    }
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error(`Malformed checksum for ${name}`);
    return { hash, name, version };
  }
  throw new Error(`No ${target.triple} archive in the release's SHA256SUMS`);
}

/** Whether this Linux system uses musl, which the glibc builds cannot run on. */
export function isMusl(): boolean {
  try {
    return readdirSync('/lib').some((name) => name.startsWith('ld-musl-'));
  } catch {
    // No /lib means no musl loader there either.
    return false;
  }
}

/** Installs the requested devlanes version (or reuses the tool cache) and puts it on PATH. */
export async function install(version: string): Promise<Installed> {
  const target = releaseTarget(
    process.platform,
    process.arch,
    process.platform === 'linux' && isMusl()
  );
  const folder = `${releasesUrl}/${releaseFolder(version)}`;

  // An exact version can skip the network entirely on a self-hosted runner that has it.
  if (version !== 'latest' && version !== 'next') {
    const cached = tc.find('devlanes', version, process.arch);
    if (cached) return use(cached, target, version);
  }

  const sumsPath = await tc.downloadTool(`${folder}/SHA256SUMS`);
  const archive = findArchive(await readFile(sumsPath, 'utf8'), target, version);

  const cached = tc.find('devlanes', archive.version, process.arch);
  if (cached) return use(cached, target, archive.version);

  core.info(`Downloading devlanes ${archive.version} (${target.triple})`);
  // `next` only ever holds its newest build, so the archive comes from the same folder as the sums.
  const archiveFolder =
    version === 'latest' ? `${releasesUrl}/download/v${archive.version}` : folder;
  // Windows PowerShell's Expand-Archive refuses a file without the .zip extension, and
  // downloadTool names files with a bare UUID unless given a destination.
  const destination = join(process.env.RUNNER_TEMP ?? tmpdir(), randomUUID(), archive.name);
  const downloaded = await tc.downloadTool(`${archiveFolder}/${archive.name}`, destination);
  const actual = createHash('sha256')
    .update(await readFile(downloaded))
    .digest('hex');
  if (actual !== archive.hash) {
    throw new Error(
      `Checksum mismatch for ${archive.name}: expected ${archive.hash}, got ${actual}`
    );
  }

  const extracted =
    target.extension === '.zip' ? await tc.extractZip(downloaded) : await tc.extractTar(downloaded);
  const top = join(extracted, `devlanes-${archive.version}-${target.triple}`);
  const dir = await tc.cacheDir(top, 'devlanes', archive.version, process.arch);
  return use(dir, target, archive.version);
}

/** Puts an installed directory on PATH for this and later steps. */
function use(dir: string, target: Target, version: string): Installed {
  core.addPath(dir);
  return { version, bin: join(dir, target.executable) };
}
