// Prepares the runner before the daemon starts: user config, the proxy's ports and, on Linux,
// trust in the devlanes CA. The daemon reads all of these only when it starts.

import { spawn } from 'node:child_process';
import { dirname } from 'node:path';
import * as core from '@actions/core';
import { parse } from 'yaml';
import { type Devlanes, parseJson } from './devlanes.ts';

/**
 * Settings every CI daemon gets. A lane without requests would otherwise be throttled after 5
 * minutes and frozen after 15, such as during a build between `start` and the tests. From
 * devlanes 0.7.0 a daemon that only commands used exits after about 5 idle minutes, which would
 * end the daemon `command: install` started before a later step uses it; the post step stops it.
 * The start gate keeps its adaptive default: it starts at full speed and only backs off when
 * CPU or memory runs short, which on a small runner is what keeps a large start from swapping.
 */
export const ciConfig: [string, string][] = [
  ['lanes.freeze_after', '0s'],
  ['lanes.throttle_after', '0s'],
  ['daemon.exit_when_idle', 'false']
];

/** One `devlanes config set` (or `unset`, for a null value). */
export interface ConfigChange {
  key: string;
  value: string | null;
}

/**
 * The `config` input as dotted settings. Mappings become dotted keys; lists and scalars are
 * values that `devlanes config set` reads as YAML, so it validates them as the CLI does.
 */
export function flattenConfig(text: string): ConfigChange[] {
  if (!text.trim()) return [];
  const document: unknown = parse(text);
  if (!isMapping(document)) throw new Error('Input "config" must be a YAML mapping');

  const changes: ConfigChange[] = [];
  const visit = (value: unknown, path: string[]) => {
    if (isMapping(value)) {
      for (const [key, child] of Object.entries(value)) visit(child, [...path, key]);
      return;
    }
    const key = path.join('.');
    if (value === null) changes.push({ key, value: null });
    else if (typeof value === 'string') changes.push({ key, value });
    else changes.push({ key, value: JSON.stringify(value) });
  };
  visit(document, []);
  return changes;
}

/** Whether a parsed YAML value is a mapping. */
function isMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Applies config changes, failing on the first one devlanes refuses. */
export async function applyConfig(devlanes: Devlanes, changes: ConfigChange[]): Promise<void> {
  for (const { key, value } of changes) {
    const args = value === null ? ['config', 'unset', key] : ['config', 'set', key, value];
    const result = await devlanes.run(args);
    if (result.code !== 0) {
      throw new Error(
        `devlanes ${args.join(' ')} failed: ${(result.stderr || result.stdout).trim()}`
      );
    }
  }
}

/** Runs a command without a shell and reports whether it exited 0. */
export function succeeds(command: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'ignore' });
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}

/** Lets unprivileged processes bind 80 and 443 so public URLs carry no port. Linux only. */
export async function allowLowPorts(): Promise<void> {
  if (!(await succeeds('sudo', ['-n', 'true']))) {
    core.warning(
      'low-ports needs passwordless sudo; the devlanes proxy falls back to ports 8443 and 8080'
    );
    return;
  }
  if (
    !(await succeeds('sudo', [
      '-n',
      'sysctl',
      '-q',
      '-w',
      'net.ipv4.ip_unprivileged_port_start=80'
    ]))
  ) {
    core.warning(
      'Could not lower net.ipv4.ip_unprivileged_port_start; the proxy falls back to 8443 and 8080'
    );
  }
}

/**
 * Makes sure `certutil` exists, so `tls.trust: chrome` can reach the NSS store that Chromium
 * and Playwright's browsers read. Returns false when it is missing and cannot be installed.
 */
export async function ensureCertutil(): Promise<boolean> {
  if (await succeeds('certutil', ['-H'])) return true;
  if (!(await succeeds('sudo', ['-n', 'true'])) || !(await succeeds('apt-get', ['--version']))) {
    return false;
  }
  const install = ['-n', 'apt-get', 'install', '-y', '-qq', 'libnss3-tools'];
  if (await succeeds('sudo', install)) return true;
  // Stale package lists on older images make the first install 404.
  await succeeds('sudo', ['-n', 'apt-get', 'update', '-qq']);
  return succeeds('sudo', install);
}

/** Trusts the devlanes CA on Linux through `devlanes certs trust`; problems become warnings. */
export async function trustLinux(devlanes: Devlanes, hostsFile: boolean): Promise<void> {
  const trustBrowsers = await ensureCertutil();
  await applyConfig(devlanes, [
    { key: 'tls.trust', value: trustBrowsers ? '[system, chrome]' : '[system]' }
  ]);
  if (!trustBrowsers) {
    core.warning(
      'certutil is missing and could not be installed; Chromium and Playwright will not trust the devlanes CA'
    );
  }

  const args = hostsFile ? ['certs', 'trust', '--hosts'] : ['certs', 'trust'];
  const result = await devlanes.run(args, { stream: true });
  if (result.code !== 0) core.warning(`devlanes ${args.join(' ')} exited ${result.code}`);
}

/** The warning for runners where the OS store cannot be changed without a person. */
export function trustSkippedWarning(platform: NodeJS.Platform): string {
  const os = platform === 'darwin' ? 'macOS' : 'Windows';
  return `Skipped devlanes certs trust: ${os} asks for confirmation in a dialog, which a runner cannot answer. Node, Deno, Python and OpenSSL-based tools still trust the CA through export-ca; browsers and curl do not. Set trust: false to hide this warning.`;
}

/** `devlanes daemon status --json`, which also names the devlanes home in use. */
export interface DaemonStatus {
  running: boolean;
  home: string | null;
}

/**
 * The daemon's state. The command exits 1 when no daemon runs and then names the home; a
 * running daemon names its config file in the home instead.
 */
export async function daemonStatus(devlanes: Devlanes): Promise<DaemonStatus> {
  const result = await devlanes.run(['daemon', 'status', '--json']);
  const status = parseJson<{ running?: boolean; home?: string; user_config?: { path?: string } }>(
    result.stdout,
    ['daemon', 'status']
  );
  const config = status.user_config?.path;
  return {
    running: status.running === true,
    home: status.home ?? (config ? dirname(config) : null)
  };
}
