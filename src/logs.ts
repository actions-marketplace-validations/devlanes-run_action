// Log artifacts. devlanes writes one file per unit with --logs-dir; the action adds what those
// files miss when something broke (the daemon's log, doctor, container logs) and uploads them.

import { readdirSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DefaultArtifactClient } from '@actions/artifact';
import * as core from '@actions/core';
import type { Devlanes } from './devlanes.ts';
import type { UploadMode } from './inputs.ts';
import type { LaneSummary } from './outputs.ts';

/** Whether logs are uploaded for this outcome. */
export function shouldUpload(mode: UploadMode, failed: boolean): boolean {
  return mode === 'always' || (mode === 'on-failure' && failed);
}

/** The artifact name when `artifact-name` is empty. */
export function defaultArtifactName(env: NodeJS.ProcessEnv): string {
  return `devlanes-logs-${env.GITHUB_JOB || 'job'}`;
}

/**
 * Names to try in order. Jobs of a matrix share their job id, and an artifact name can be used
 * once per run, so later jobs take the next free suffix.
 */
export function artifactNames(base: string): string[] {
  return [base, ...Array.from({ length: 8 }, (_, index) => `${base}-${index + 2}`)];
}

/** Whether an upload failed because the run already has an artifact with that name. */
export function isNameTaken(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\(409\)|conflict|already exists/i.test(message);
}

/** Every file under `dir`. */
export function filesUnder(dir: string): string[] {
  try {
    return readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name));
  } catch {
    // A start that failed before any unit ran leaves no directory.
    return [];
  }
}

/** Writes the daemon's log, doctor, status and container logs next to the unit logs. */
export async function writeDiagnostics(
  devlanes: Devlanes,
  dir: string,
  lane: LaneSummary | undefined
): Promise<void> {
  await mkdir(dir, { recursive: true });
  const save = async (file: string, args: string[]) => {
    const result = await devlanes.run(args);
    const text = [result.stdout, result.stderr].filter(Boolean).join('\n');
    if (text) await writeFile(join(dir, file), text);
  };

  await save('devlanes-daemon.log', ['daemon', 'logs', '--tail', '5000']);
  await save('devlanes-doctor.txt', ['doctor']);
  if (lane) {
    await writeFile(join(dir, 'devlanes-status.json'), `${JSON.stringify(lane, null, 2)}\n`);
    for (const container of lane.containers ?? []) {
      const name = container.name.replace(/[^A-Za-z0-9._-]/g, '_');
      await save(`infra-${name}.log`, ['infra', 'logs', container.name, '--tail', '1000']);
    }
  }
}

/** Uploads `dir` as an artifact and returns the name it got, or null without files. */
export async function uploadLogs(
  dir: string,
  base: string,
  retentionDays: number | undefined
): Promise<string | null> {
  const files = filesUnder(dir);
  if (files.length === 0) {
    core.info(`No devlanes logs in ${dir} to upload`);
    return null;
  }

  const client = new DefaultArtifactClient();
  for (const name of artifactNames(base)) {
    try {
      await client.uploadArtifact(
        name,
        files,
        dir,
        retentionDays === undefined ? {} : { retentionDays }
      );
      core.info(`Uploaded ${files.length} log files as artifact ${name}`);
      return name;
    } catch (error) {
      if (!isNameTaken(error)) throw error;
    }
  }
  throw new Error(`Every artifact name from ${base} to ${base}-9 is taken; set artifact-name`);
}
