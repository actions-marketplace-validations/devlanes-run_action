import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type Job, jobFailedSteps, stepReport } from './job.ts';

/** The running job on runner 2, with its test step in the given state. */
function jobs(test: { status: string; conclusion: string | null }): Job[] {
  return [
    {
      status: 'completed',
      runner_name: 'GitHub Actions 1',
      steps: [{ name: 'Test', status: 'completed', conclusion: 'failure' }]
    },
    {
      status: 'in_progress',
      runner_name: 'GitHub Actions 2',
      steps: [
        { name: 'Start the lane', status: 'completed', conclusion: 'success' },
        { name: 'Test', ...test },
        { name: 'Post Start the lane', status: 'in_progress', conclusion: null },
        { name: 'Complete job', status: 'pending', conclusion: null }
      ]
    }
  ];
}

const failed = jobs({ status: 'completed', conclusion: 'failure' });
const passed = jobs({ status: 'completed', conclusion: 'success' });
const lagging = jobs({ status: 'in_progress', conclusion: null });

const env = {
  GITHUB_API_URL: 'https://api.github.com',
  GITHUB_REPOSITORY: 'acme/app',
  GITHUB_RUN_ID: '42',
  GITHUB_RUN_ATTEMPT: '2',
  RUNNER_NAME: 'GitHub Actions 2'
};

/** A fetch that answers each request with the next page of jobs and records the requests. */
function api(...answers: Job[][]) {
  const requests: { url: string; authorization: string | undefined }[] = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    const headers = init?.headers as Record<string, string> | undefined;
    requests.push({ url, authorization: headers?.authorization });
    const page = answers[Math.min(requests.length - 1, answers.length - 1)] ?? [];
    return Response.json({ total_count: page.length, jobs: page });
  }) as typeof fetch;
  return { fetcher, requests };
}

const noWait = async () => {};

test('the report covers the running job on this runner only', () => {
  assert.deepEqual(stepReport(failed, 'GitHub Actions 2'), { failed: ['Test'], settled: true });
  assert.deepEqual(stepReport(lagging, 'GitHub Actions 2'), { failed: [], settled: false });
  assert.equal(stepReport(failed, 'GitHub Actions 9'), null);
});

test('the API is asked for this run attempt with the token', async () => {
  const { fetcher, requests } = api(failed);
  assert.deepEqual(await jobFailedSteps(env, 'token', fetcher, noWait), ['Test']);
  assert.deepEqual(requests, [
    {
      url: 'https://api.github.com/repos/acme/app/actions/runs/42/attempts/2/jobs?per_page=100&page=1',
      authorization: 'Bearer token'
    }
  ]);
});

test('a step the API has not recorded yet is asked about again', async () => {
  const { fetcher, requests } = api(lagging, lagging, failed);
  assert.deepEqual(await jobFailedSteps(env, 'token', fetcher, noWait), ['Test']);
  assert.equal(requests.length, 3);

  assert.deepEqual(await jobFailedSteps(env, 'token', api(lagging, passed).fetcher, noWait), []);
  assert.equal(await jobFailedSteps(env, 'token', api(lagging).fetcher, noWait), null);
});

test('a refused request or a missing variable means the answer is unknown', async () => {
  const forbidden = (async () => new Response('', { status: 403 })) as unknown as typeof fetch;
  assert.equal(await jobFailedSteps(env, 'token', forbidden, noWait), null);
  assert.equal(await jobFailedSteps({ ...env, RUNNER_NAME: undefined }, 'token', forbidden), null);
});
