// Hosts file entries for the lane's hostnames on Windows runners. Windows 11 answers *.localhost
// with loopback by itself, but Windows Server 2025 (windows-latest) does not, and devlanes never
// writes the hosts file on Windows. Runners are elevated, so the action can.

import { lookup } from 'node:dns/promises';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LaneSummary } from './outputs.ts';

const begin = '# devlanes action begin';
const end = '# devlanes action end';

/** The Windows hosts file. */
export function hostsPath(env: NodeJS.ProcessEnv): string {
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
    const { hostname } = new URL(url);
    // A hosts file takes only exact names; wildcards need devlanes' resolver strategy.
    if (!hostname.includes('*')) hosts.add(hostname);
  }
  return [...hosts].sort();
}

/** `text` without the action's block. */
export function withoutBlock(text: string): string {
  const pattern = new RegExp(`${begin}[\\s\\S]*?${end}\\r?\\n?`, 'g');
  return text.replace(pattern, '');
}

/** `text` with the action's block listing `hosts`, replacing an earlier block. */
export function withBlock(text: string, hosts: string[]): string {
  const rest = withoutBlock(text).replace(/\s*$/, '');
  const lines = [begin, ...hosts.map((host) => `127.0.0.1 ${host}`), end];
  return `${rest}${rest ? '\r\n' : ''}${lines.join('\r\n')}\r\n`;
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

/** Writes the block with `hosts` into the hosts file at `path`. */
export async function addHosts(path: string, hosts: string[]): Promise<void> {
  await writeFile(path, withBlock(await readFile(path, 'utf8'), hosts));
}

/** Removes the action's block from the hosts file at `path`. */
export async function removeHosts(path: string): Promise<void> {
  const text = await readFile(path, 'utf8');
  const cleaned = withoutBlock(text);
  if (cleaned !== text) await writeFile(path, cleaned);
}
