// The action's post step, which the runner runs at the end of the job even after a failure or
// a cancellation: stop the lane, upload its logs and stop the daemon this invocation started.
// Problems here are warnings, since the job's result belongs to its own steps.

import * as core from '@actions/core';
import { cli, type Devlanes } from './devlanes.ts';
import { childEnv } from './env.ts';
import { readInputs } from './inputs.ts';
import { defaultArtifactName, shouldUpload, uploadLogs, writeDiagnostics } from './logs.ts';
import { failedUnits, type LaneEnv, type LaneSummary, type StatusPage } from './outputs.ts';
import { loadState, stoppedVariable } from './state.ts';

/** Runs the post step. */
async function post(): Promise<void> {
  const state = loadState();
  if (!state) return;
  const inputs = readInputs((name) => core.getInput(name), process.platform);
  if (inputs.cleanup === 'keep') {
    core.info('cleanup is keep; leaving the lane and the daemon running');
    return;
  }

  const devlanes = cli(state.bin, childEnv(process.env, inputs.home));
  // A later `command: stop` step already stopped the lane and uploaded its logs.
  const stopped = process.env[stoppedVariable] === '1';
  let failed = state.failed;

  let lane: LaneSummary | undefined;
  if (!stopped && inputs.command !== 'install') {
    const reference = state.lane || (await currentLane(devlanes, state.cwd));
    if (reference) {
      lane = await attempt('read the lane status', async () => {
        const page = await devlanes.json<StatusPage>(['status', reference], { cwd: state.cwd });
        return page.items.find((item) => item.reference === reference) ?? page.items[0];
      });
      if (failedUnits(lane).length > 0) failed = true;

      // `with` already stopped what it started and wrote its logs.
      if (inputs.command === 'start') {
        const result = await devlanes.run(
          ['stop', '--lane', reference, '--logs-dir', state.logsDir],
          { cwd: state.cwd, stream: true }
        );
        if (result.code !== 0) {
          failed = true;
          core.warning(`devlanes stop exited ${result.code}`);
        }
      }
    }

    if (shouldUpload(inputs.uploadLogs, failed)) {
      await attempt('upload the devlanes logs', async () => {
        await writeDiagnostics(devlanes, state.logsDir, lane);
        await uploadLogs(
          state.logsDir,
          inputs.artifactName || defaultArtifactName(process.env),
          inputs.retentionDays
        );
      });
    }

    if (inputs.cleanup === 'clean' && reference) {
      await attempt('clean the lane', async () => {
        await devlanes.run(['lane', 'clean', reference, '--yes'], { cwd: state.cwd, stream: true });
        await devlanes.run(['infra', 'down', '--yes'], { cwd: state.cwd, stream: true });
      });
    }
  }

  if (state.daemonStarted) {
    await attempt('stop the daemon', async () => {
      await devlanes.run(['daemon', 'stop', '--yes'], { stream: true });
    });
  }
}

/** The lane of `cwd`, for a main step that ended before it could save it. */
async function currentLane(devlanes: Devlanes, cwd: string): Promise<string> {
  const laneEnv = await attempt('read the lane', () =>
    devlanes.json<LaneEnv>(['env', 'show'], { cwd })
  );
  return laneEnv?.lane ?? '';
}

/** Runs `task`, turning a failure into a warning that says what could not be done. */
async function attempt<T>(what: string, task: () => Promise<T>): Promise<T | undefined> {
  try {
    return await task();
  } catch (error) {
    core.warning(`Could not ${what}: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

post().catch((error: unknown) =>
  core.warning(error instanceof Error ? error.message : String(error))
);
