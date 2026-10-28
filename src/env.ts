// The environment devlanes and the `with` command run in. Services inherit it through
// `devlanes start`, so the action's own plumbing must not leak into them.

/** Variables the runner gives JavaScript actions only; `run:` steps never see them. */
const runnerOnly = new Set([
  'ACTIONS_RUNTIME_TOKEN',
  'ACTIONS_RUNTIME_URL',
  'ACTIONS_RESULTS_URL',
  'ACTIONS_CACHE_URL',
  'ACTIONS_CACHE_SERVICE_V2'
]);

/**
 * The environment for devlanes processes: this step's environment without action inputs, saved
 * state or runner tokens, with output settings that keep the CLI's GitHub Actions log groups
 * and annotations on even when an AI agent runs the job.
 */
export function childEnv(base: NodeJS.ProcessEnv, home: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined) continue;
    const upper = key.toUpperCase();
    if (upper.startsWith('INPUT_') || upper.startsWith('STATE_') || runnerOnly.has(upper)) continue;
    env[key] = value;
  }

  env.DEVLANES_OUTPUT = 'plain';
  env.DEVLANES_AGENT = '0';
  env.DEVLANES_NO_UI = '1';
  if (home) env.DEVLANES_HOME = home;
  return env;
}
