// Log artifacts. devlanes writes one file per unit with --logs-dir; the action adds what those
// files miss (the daemon's log, doctor, container logs) on a stop step and before an upload.

import { readdirSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DefaultArtifactClient } from '@actions/artifact';
import * as core from '@actions/core';
import type { Devlanes } from './devlanes.ts';
import type { UploadMode } from './inputs.ts';
import { jobName } from './job.ts';
import type { LaneSummary } from './outputs.ts';

/**
 * The logs folder of `lane`. One folder per lane keeps two projects in one job from overwriting
 * each other's `unit-api.log`, and lets `start` name the folder a later `stop` writes into.
 */
export function laneLogsDir(env: NodeJS.ProcessEnv, lane: string): string {
  const name = (lane || 'lane').replace(/[^A-Za-z0-9._-]/g, '_');
  return join(env.RUNNER_TEMP ?? tmpdir(), 'devlanes-logs', name);
}

/** Whether logs are uploaded for this outcome. */
export function shouldUpload(mode: UploadMode, failed: boolean): boolean {
  return mode === 'always' || (mode === 'on-failure' && failed);
}

/** `text` with every run of characters an artifact name should not hold turned into one `-`. */
function slug(text: string): string {
  return text
    .replace(/[^A-Za-z0-9._]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

/**
 * The artifact name when `artifact-name` is empty: the job's display name, which differs
 * between the jobs of a matrix, and the lane, which differs between projects in one job. The
 * artifact service accepts the same name from several jobs and keeps only one of them, so a
 * name shared by two jobs would lose logs. Without a display name, the runner's name keeps the
 * jobs of a matrix apart instead.
 */
export function defaultArtifactName(
  env: NodeJS.ProcessEnv,
  jobName: string | null,
  lane: string
): string {
  const job = slug(jobName || [env.GITHUB_JOB || 'job', env.RUNNER_NAME ?? ''].join('-'));
  return lane ? `devlanes-logs-${job}-${slug(lane)}` : `devlanes-logs-${job}`;
}

/** The artifact name to upload under: `artifact-name`, else the default for this job and lane. */
export async function artifactName(
  given: string,
  env: NodeJS.ProcessEnv,
  token: string,
  lane: string
): Promise<string> {
  if (given) return given;
  const name = await jobName(env, token);
  if (!name) {
    core.warning(
      "Could not read this job's name from the GitHub API, so the logs artifact is named after the runner; set artifact-name for a stable name"
    );
  }
  return defaultArtifactName(env, name, lane);
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

/** Uploads `dir` as the artifact `name`, doing nothing when it holds no files. */
export async function uploadLogs(
  dir: string,
  name: string,
  retentionDays: number | undefined
): Promise<void> {
  const files = filesUnder(dir);
  if (files.length === 0) {
    core.info(`No devlanes logs in ${dir} to upload`);
    return;
  }
  const options = retentionDays === undefined ? {} : { retentionDays };
  await new DefaultArtifactClient().uploadArtifact(name, files, dir, options);
  core.info(`Uploaded ${files.length} log files as artifact ${name}`);
}
