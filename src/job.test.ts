import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type Job, jobFailedSteps, stepReport } from './job.ts';

type Step = NonNullable<Job['steps']>[number];

/** A step in one of the states the API reports. */
function step(name: string, status: string, conclusion: string | null = null): Step {
  return { name, status, conclusion };
}

/** Jobs of a run: another runner's failed job, and the running job on runner 2. */
function jobs(...steps: Step[]): Job[] {
  return [
    {
      status: 'completed',
      runner_name: 'GitHub Actions 1',
      steps: [step('Test', 'completed', 'failure')]
    },
    { status: 'in_progress', runner_name: 'GitHub Actions 2', steps }
  ];
}

const started = step('Start the lane', 'completed', 'success');
const testFailed = step('Test', 'completed', 'failure');
const testPassed = step('Test', 'completed', 'success');
const testRunning = step('Test', 'in_progress');
const post = step('Post Start the lane', 'in_progress');
const complete = step('Complete job', 'pending');

/** The post step's view: the main steps done, this post step running. */
const failedJob = jobs(started, testFailed, post, complete);
const passedJob = jobs(started, testPassed, post, complete);
/** The API has not recorded the test step's end yet. */
const laggingJob = jobs(started, testRunning, post, complete);

const env = {
  GITHUB_API_URL: 'https://api.github.com',
  GITHUB_REPOSITORY: 'acme/app',
  GITHUB_RUN_ID: '42',
  GITHUB_RUN_ATTEMPT: '2',
  RUNNER_NAME: 'GitHub Actions 2'
};

/** A fetch that answers request N with `answers[N]` (or the last one) and records requests. */
function api(...answers: (Job[] | number)[]) {
  const requests: { url: string; authorization: string | undefined }[] = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    const headers = init?.headers as Record<string, string> | undefined;
    requests.push({ url, authorization: headers?.authorization });
    const answer = answers[Math.min(requests.length - 1, answers.length - 1)] ?? [];
    if (typeof answer === 'number') return new Response('', { status: answer });
    return Response.json({ total_count: answer.length, jobs: answer });
  }) as typeof fetch;
  return { fetcher, requests };
}

const noWait = async () => {};

test('the report covers the running job on this runner only', () => {
  assert.deepEqual(stepReport(failedJob, 'GitHub Actions 2'), { failed: ['Test'], settled: true });
  assert.deepEqual(stepReport(laggingJob, 'GitHub Actions 2'), { failed: [], settled: false });
  assert.equal(stepReport(failedJob, 'GitHub Actions 9'), null);
});

test('a main step is settled while it runs and later steps wait', () => {
  // `command: stop` runs as a main step: it is in progress and the steps after it are pending.
  const main = jobs(
    started,
    testPassed,
    step('Stop the lane', 'in_progress'),
    step('Deploy', 'pending')
  );
  assert.deepEqual(stepReport(main, 'GitHub Actions 2'), { failed: [], settled: true });
  // The step before it still shows as running, so the API is behind.
  const behind = jobs(started, testRunning, step('Stop the lane', 'in_progress'));
  assert.deepEqual(stepReport(behind, 'GitHub Actions 2'), { failed: [], settled: false });
});

test('cancelled and timed-out steps count as failures', () => {
  const cancelled = jobs(started, step('Test', 'completed', 'cancelled'), post);
  const timedOut = jobs(started, step('Test', 'completed', 'timed_out'), post);
  assert.deepEqual(stepReport(cancelled, 'GitHub Actions 2')?.failed, ['Test']);
  assert.deepEqual(stepReport(timedOut, 'GitHub Actions 2')?.failed, ['Test']);
});

test('the API is asked for this run attempt with the token', async () => {
  const { fetcher, requests } = api(failedJob);
  assert.deepEqual(await jobFailedSteps(env, 'token', fetcher, noWait), ['Test']);
  assert.deepEqual(requests, [
    {
      url: 'https://api.github.com/repos/acme/app/actions/runs/42/attempts/2/jobs?per_page=100&page=1',
      authorization: 'Bearer token'
    }
  ]);
});

test('every page of jobs is read', async () => {
  const requests: string[] = [];
  const fetcher = (async (url: string) => {
    requests.push(url);
    const page = Number(new URL(url).searchParams.get('page'));
    const listed = page === 1 ? [failedJob[0]] : [failedJob[1]];
    return Response.json({ total_count: 2, jobs: listed });
  }) as typeof fetch;
  assert.deepEqual(await jobFailedSteps(env, '', fetcher, noWait), ['Test']);
  assert.equal(requests.length, 2);
});

test('steps the API has not recorded yet and server errors are asked about again', async () => {
  const lagging = api(laggingJob, laggingJob, failedJob);
  assert.deepEqual(await jobFailedSteps(env, 'token', lagging.fetcher, noWait), ['Test']);
  assert.equal(lagging.requests.length, 3);

  assert.deepEqual(await jobFailedSteps(env, 'token', api(503, passedJob).fetcher, noWait), []);
  assert.deepEqual(await jobFailedSteps(env, 'token', api(laggingJob).fetcher, noWait), {
    reason: 'the API did not record the earlier steps in time'
  });
});

test('a refused request or a missing variable says why the answer is unknown', async () => {
  assert.deepEqual(await jobFailedSteps(env, 'token', api(403).fetcher, noWait), {
    reason: 'the token cannot read the run; give the job `actions: read`'
  });
  const unset = await jobFailedSteps({ ...env, RUNNER_NAME: undefined }, 'token', api(403).fetcher);
  assert.ok(!Array.isArray(unset));
});
