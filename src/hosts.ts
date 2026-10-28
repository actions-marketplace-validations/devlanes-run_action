// Hosts file entries for the lane's hostnames on runners whose resolver does not answer
// *.localhost: Windows Server 2025 (windows-latest) and macOS before 26. Linux runners resolve
// those names, and devlanes' own helper covers programs that skip the resolver there. Windows
// runners are elevated and macOS runners have passwordless sudo, so the action can write the file.

import { spawn } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LaneSummary } from './outputs.ts';

/** The hosts file of `platform`. */
export function hostsPath(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string {
  if (platform !== 'win32') return '/etc/hosts';
  return join(env.SystemRoot ?? 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts');
}

/** Exact hostnames of a lane's services and containers, from the https URLs it lists. */
export function laneHostnames(lane: LaneSummary | undefined): string[] {
  const urls = [
    ...(lane?.units ?? []).flatMap((unit) => unit.urls ?? []),
    ...(lane?.containers ?? []).flatMap((container) => container.urls ?? [])
  ];
  const hosts = new Set<string>();
  for (const url of urls) {
    if (!url.startsWith('https://')) continue;
    let hostname: string;
    try {
      hostname = new URL(url).hostname;
    } catch {
      // A URL the daemon printed but URL cannot parse has no name worth writing.
      continue;
    }
    // A hosts file takes only exact names; wildcards need devlanes' resolver strategy.
    if (!hostname.includes('*')) hosts.add(hostname);
  }
  return [...hosts].sort();
}

/** The markers of the block of lane `id`, so two lanes in one job keep their own entries. */
function markers(id: string): [string, string] {
  return [`# devlanes action begin ${id}`, `# devlanes action end ${id}`];
}

/** Escapes `text` for use inside a regular expression. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `text` without the block of `id`. */
export function withoutBlock(text: string, id: string): string {
  const [begin, end] = markers(id).map(escapeRegExp);
  return text.replace(new RegExp(`${begin}\\r?\\n[\\s\\S]*?${end}\\r?\\n?`, 'g'), '');
}

/** `text` with the block of `id` listing `hosts`, replacing an earlier block of `id`. */
export function withBlock(text: string, id: string, hosts: string[], eol: string): string {
  const rest = withoutBlock(text, id).replace(/\s*$/, '');
  const [begin, end] = markers(id);
  const lines = [begin, ...hosts.map((host) => `127.0.0.1 ${host}`), end];
  return `${rest}${rest ? eol : ''}${lines.join(eol)}${eol}`;
}

/** Whether `host` already resolves to loopback. */
export async function resolvesToLoopback(host: string): Promise<boolean> {
  try {
    const { address } = await lookup(host);
    return address === '127.0.0.1' || address === '::1';
  } catch {
    return false;
  }
}

/** Runs `sudo -n` with `args`, feeding `input` on stdin, and fails on a non-zero exit. */
function sudo(args: string[], input = ''): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('sudo', ['-n', ...args], { stdio: ['pipe', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`sudo ${args[0]} exited ${code}: ${stderr.trim()}`))
    );
    child.stdin.end(input);
  });
}

/** Replaces the hosts file with `text`, through sudo on macOS, and makes the resolver reread it. */
async function writeHosts(platform: NodeJS.Platform, path: string, text: string): Promise<void> {
  if (platform === 'win32') {
    // The DNS client watches the file, so new entries resolve without a cache flush.
    await writeFile(path, text);
    return;
  }
  await sudo(['tee', path], text);
  // The file is written; a cache that stays stale only delays the new names.
  await sudo(['dscacheutil', '-flushcache']).catch(() => {});
  await sudo(['killall', '-HUP', 'mDNSResponder']).catch(() => {});
}

/** Writes the block of lane `id` with `hosts` into the hosts file. */
export async function addHosts(
  platform: NodeJS.Platform,
  path: string,
  id: string,
  hosts: string[]
) {
  const eol = platform === 'win32' ? '\r\n' : '\n';
  await writeHosts(platform, path, withBlock(await readFile(path, 'utf8'), id, hosts, eol));
}

/** Removes the block of lane `id` from the hosts file. */
export async function removeHosts(platform: NodeJS.Platform, path: string, id: string) {
  const text = await readFile(path, 'utf8');
  const cleaned = withoutBlock(text, id);
  if (cleaned !== text) await writeHosts(platform, path, cleaned);
}
