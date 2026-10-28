// Whether the job has a failed step, for `upload-logs: on-failure`. An action cannot read
// `job.status`, so this asks the API for the job that runs on this runner.

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

/** The failed steps of a job, and whether the API had caught up with the steps before this one. */
export interface StepReport {
  failed: string[];
  settled: boolean;
}

/** Step conclusions that mean the step did not succeed; a timed-out test is the one that needs logs most. */
const failures = new Set(['failure', 'cancelled', 'timed_out']);

/**
 * The running job on `runner`, or null when it is not listed. The steps before the first one
 * that has not completed must have completed, and that one must be the step running now (this
 * action's main or post step): a step the API still shows as running before it means the API
 * has not recorded that step's result yet.
 */
export function stepReport(jobs: Job[], runner: string): StepReport | null {
  const job = jobs.find((entry) => entry.status === 'in_progress' && entry.runner_name === runner);
  if (!job) return null;
  const steps = job.steps ?? [];
  const current = steps.findIndex((step) => step.status !== 'completed');
  const settled =
    current === -1 ||
    (steps[current]?.status === 'in_progress' &&
      steps.slice(current + 1).every((step) => step.status !== 'in_progress'));
  return {
    failed: steps
      .filter((step) => step.conclusion !== null && failures.has(step.conclusion))
      .map((step) => step.name),
    settled
  };
}

/** What one round of requests found: every job, a refusal, or an answer worth retrying. */
type Jobs = Job[] | 'refused' | 'retry';

/** Every job of this run attempt, across pages. */
async function runJobs(
  env: NodeJS.ProcessEnv,
  token: string,
  fetcher: typeof fetch
): Promise<Jobs> {
  const { GITHUB_API_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } = env;
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
    if (response.status === 429 || response.status >= 500) return 'retry';
    if (!response.ok) return 'refused';
    const body = (await response.json()) as JobsPage;
    jobs.push(...body.jobs);
    if (jobs.length >= body.total_count || body.jobs.length === 0) break;
  }
  return jobs;
}

/** Why the API could not say whether a step failed. */
export type Unknown = { reason: string };

/**
 * Failed steps of this job, or why the API cannot tell. The API records a step's result a moment
 * after the step ends, and the next step can start sooner, so it asks again until it has caught
 * up, for about 20 seconds.
 */
export async function jobFailedSteps(
  env: NodeJS.ProcessEnv,
  token: string,
  fetcher: typeof fetch = fetch,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((done) => setTimeout(done, ms))
): Promise<string[] | Unknown> {
  const { GITHUB_API_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID, RUNNER_NAME } = env;
  if (!GITHUB_API_URL || !GITHUB_REPOSITORY || !GITHUB_RUN_ID || !RUNNER_NAME) {
    return { reason: 'the runner did not set the run and runner variables' };
  }

  let reason = 'the API did not record the earlier steps in time';
  for (let attempt = 0; attempt < 10; attempt++) {
    if (attempt > 0) await wait(2_000);
    const jobs = await runJobs(env, token, fetcher);
    if (jobs === 'refused') {
      return { reason: 'the token cannot read the run; give the job `actions: read`' };
    }
    if (jobs === 'retry') {
      reason = 'the API kept answering with errors';
      continue;
    }
    const report = stepReport(jobs, RUNNER_NAME);
    if (!report) return { reason: `the API does not list a running job on ${RUNNER_NAME}` };
    // A failure the API already shows is enough; there is nothing more to wait for.
    if (report.settled || report.failed.length > 0) return report.failed;
  }
  return { reason };
}

/**
 * Whether a step of this job failed so far. When the API cannot tell, it answers yes, since
 * uploading logs nobody needed costs less than missing the logs of a failure.
 */
export async function jobFailed(env: NodeJS.ProcessEnv, token: string): Promise<boolean> {
  let steps: string[] | Unknown;
  try {
    steps = await jobFailedSteps(env, token);
  } catch (error) {
    steps = { reason: error instanceof Error ? error.message : String(error) };
  }
  if (!Array.isArray(steps)) {
    core.warning(
      `Uploading the logs because the action could not tell whether a step failed: ${steps.reason}`
    );
    return true;
  }
  if (steps.length > 0) {
    core.info(`Uploading the logs because these steps failed: ${steps.join(', ')}`);
  }
  return steps.length > 0;
}
