// What the main step leaves for the post step. The runner keeps it per action invocation, so
// two uses of the action in one job each clean up their own work.

import * as core from '@actions/core';

/** State saved by the main step once the daemon is set up; without it the post step does nothing. */
export interface State {
  bin: string;
  /** The resolved devlanes home, so the post step reaches this invocation's daemon. */
  home: string;
  cwd: string;
  logsDir: string;
  lane: string;
  daemonStarted: boolean;
  /** The lane whose block the hosts file has, which the post step removes; empty for none. */
  hostsLane: string;
  /** `devlanes with` returned; when false after `command: with`, its lane may still run. */
  withDone: boolean;
  failed: boolean;
}

const key = 'devlanes';

/** Saves the state for the post step. */
export function saveState(state: State): void {
  core.saveState(key, JSON.stringify(state));
}

/** The state from the main step, or null when it stopped before setup. */
export function loadState(): State | null {
  const raw = core.getState(key);
  return raw ? (JSON.parse(raw) as State) : null;
}

/** Set in `$GITHUB_ENV` once a job has a configured daemon, so later uses skip setup. */
export const readyVariable = 'DEVLANES_ACTION_READY';

/**
 * Set in `$GITHUB_ENV` by `command: stop` to the lanes it stopped, one per line, so the post
 * steps of earlier uses skip those lanes and still stop any other.
 */
export const stoppedVariable = 'DEVLANES_ACTION_STOPPED';

/** Lanes a `command: stop` already stopped in this job. */
export function stoppedLanes(env: NodeJS.ProcessEnv): string[] {
  return (env[stoppedVariable] ?? '').split('\n').filter(Boolean);
}
