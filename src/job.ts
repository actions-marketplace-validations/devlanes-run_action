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

/** The failed steps of a job, and whether the API had caught up with every main step. */
export interface StepReport {
  failed: string[];
  settled: boolean;
}

/** The running job on `runner`, or null when it is not listed. */
export function stepReport(jobs: Job[], runner: string): StepReport | null {
  const job = jobs.find((entry) => entry.status === 'in_progress' && entry.runner_name === runner);
  if (!job) return null;
  const steps = job.steps ?? [];
  return {
    failed: steps.filter((step) => step.conclusion === 'failure').map((step) => step.name),
    // Post steps and "Complete job" run after the main steps, so they are still pending here.
    settled: steps
      .filter((step) => !step.name.startsWith('Post ') && step.name !== 'Complete job')
      .every((step) => step.status === 'completed')
  };
}

/** Every job of this run attempt, or null when the API refuses. */
async function runJobs(
  env: NodeJS.ProcessEnv,
  token: string,
  fetcher: typeof fetch
): Promise<Job[] | null> {
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
    if (!response.ok) return null;
    const body = (await response.json()) as JobsPage;
    jobs.push(...body.jobs);
    if (jobs.length >= body.total_count || body.jobs.length === 0) break;
  }
  return jobs;
}

/**
 * Failed steps of this job, or null when the API cannot tell (a token without `actions: read`
 * on a private repository, GitHub Enterprise Server without the endpoint, or step results that
 * never arrive). The API records a step's result a moment after it ends, and the post step can
 * start sooner, so it asks again until every main step shows as completed.
 */
export async function jobFailedSteps(
  env: NodeJS.ProcessEnv,
  token: string,
  fetcher: typeof fetch = fetch,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((done) => setTimeout(done, ms))
): Promise<string[] | null> {
  const { GITHUB_API_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID, RUNNER_NAME } = env;
  if (!GITHUB_API_URL || !GITHUB_REPOSITORY || !GITHUB_RUN_ID || !RUNNER_NAME) return null;

  for (let attempt = 0; attempt < 10; attempt++) {
    if (attempt > 0) await wait(2_000);
    const jobs = await runJobs(env, token, fetcher);
    if (!jobs) return null;
    const report = stepReport(jobs, RUNNER_NAME);
    if (!report) return null;
    if (report.settled) return report.failed;
    // A failure the API already shows is enough; there is nothing more to wait for.
    if (report.failed.length > 0) return report.failed;
  }
  return null;
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
  if (steps.length > 0) {
    core.info(`Uploading the logs because these steps failed: ${steps.join(', ')}`);
  }
  return steps.length > 0;
}
