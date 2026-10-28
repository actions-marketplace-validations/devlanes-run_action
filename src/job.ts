// Whether the job has a failed step, for the post step's `upload-logs: on-failure`. An action
// cannot read `job.status`, so this asks the API for the job that runs on this runner.

import * as core from '@actions/core';

/** One job of `GET /repos/{repo}/actions/runs/{run}/attempts/{attempt}/jobs`. */
export interface Job {
  status: string;
  runner_name: string | null;
  steps?: { name: string; status: string; conclusion: string | null }[];
}

/** The page shape of that endpoint. */
interface JobsPage {
  total_count: number;
  jobs: Job[];
}

/** Names of the failed steps of the running job on `runner`, or null when it is not listed. */
export function failedSteps(jobs: Job[], runner: string): string[] | null {
  const job = jobs.find((entry) => entry.status === 'in_progress' && entry.runner_name === runner);
  if (!job) return null;
  return (job.steps ?? []).filter((step) => step.conclusion === 'failure').map((step) => step.name);
}

/**
 * Failed steps of this job, or null when the API cannot tell (a token without `actions: read`
 * on a private repository, or GitHub Enterprise Server without the endpoint).
 */
export async function jobFailedSteps(
  env: NodeJS.ProcessEnv,
  token: string,
  fetcher: typeof fetch = fetch
): Promise<string[] | null> {
  const { GITHUB_API_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID, RUNNER_NAME } = env;
  if (!GITHUB_API_URL || !GITHUB_REPOSITORY || !GITHUB_RUN_ID || !RUNNER_NAME) return null;
  const attempt = env.GITHUB_RUN_ATTEMPT || '1';

  const jobs: Job[] = [];
  for (let page = 1; page <= 10; page++) {
    const url = `${GITHUB_API_URL}/repos/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}/attempts/${attempt}/jobs?per_page=100&page=${page}`;
    const response = await fetcher(url, {
      headers: {
        accept: 'application/vnd.github+json',
        ...(token ? { authorization: `Bearer ${token}` } : {})
      },
      signal: AbortSignal.timeout(15_000)
    });
    if (!response.ok) return null;
    const body = (await response.json()) as JobsPage;
    jobs.push(...body.jobs);
    if (jobs.length >= body.total_count || body.jobs.length === 0) break;
  }
  return failedSteps(jobs, RUNNER_NAME);
}

/**
 * Whether a step of this job failed so far. When the API cannot tell, it answers yes, since
 * uploading logs nobody needed costs less than missing the logs of a failure.
 */
export async function jobFailed(env: NodeJS.ProcessEnv, token: string): Promise<boolean> {
  let steps: string[] | null;
  try {
    steps = await jobFailedSteps(env, token);
  } catch (error) {
    core.info(`Could not read the job's steps: ${error instanceof Error ? error.message : error}`);
    steps = null;
  }
  if (steps === null) {
    core.info('Could not tell whether a step failed; uploading the logs to be safe');
    return true;
  }
  if (steps.length > 0)
    core.info(`Uploading the logs because these steps failed: ${steps.join(', ')}`);
  return steps.length > 0;
}
