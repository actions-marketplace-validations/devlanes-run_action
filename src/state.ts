// What the main step leaves for the post step. The runner keeps it per action invocation, so
// two uses of the action in one job each clean up their own work.

import * as core from '@actions/core';

/** State saved by the main step. */
export interface State {
  /** Set once setup finished; the post step does nothing without it. */
  bin: string;
  home: string;
  cwd: string;
  logsDir: string;
  lane: string;
  daemonStarted: boolean;
  /** The Windows hosts file has the action's block, which the post step removes. */
  hostsWritten: boolean;
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

/** Set in `$GITHUB_ENV` after `command: stop`, so post steps do not stop the lane again. */
export const stoppedVariable = 'DEVLANES_ACTION_STOPPED';
