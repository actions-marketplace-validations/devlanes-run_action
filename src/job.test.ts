import assert from 'node:assert/strict';
import { test } from 'node:test';
import { failedSteps, type Job, jobFailedSteps } from './job.ts';

const jobs: Job[] = [
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
      { name: 'Test', status: 'completed', conclusion: 'failure' },
      { name: 'Post Start the lane', status: 'in_progress', conclusion: null }
    ]
  }
];

const env = {
  GITHUB_API_URL: 'https://api.github.com',
  GITHUB_REPOSITORY: 'acme/app',
  GITHUB_RUN_ID: '42',
  GITHUB_RUN_ATTEMPT: '2',
  RUNNER_NAME: 'GitHub Actions 2'
};

test('failed steps are read from the running job on this runner', () => {
  assert.deepEqual(failedSteps(jobs, 'GitHub Actions 2'), ['Test']);
  assert.equal(failedSteps(jobs, 'GitHub Actions 9'), null);
});

test('the API is asked for this run attempt with the token', async () => {
  const requests: { url: string; authorization: string | undefined }[] = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    const headers = init?.headers as Record<string, string> | undefined;
    requests.push({ url, authorization: headers?.authorization });
    return Response.json({ total_count: 2, jobs });
  }) as typeof fetch;

  assert.deepEqual(await jobFailedSteps(env, 'token', fetcher), ['Test']);
  assert.deepEqual(requests, [
    {
      url: 'https://api.github.com/repos/acme/app/actions/runs/42/attempts/2/jobs?per_page=100&page=1',
      authorization: 'Bearer token'
    }
  ]);
});

test('a refused request or a missing variable means the answer is unknown', async () => {
  const forbidden = (async () => new Response('', { status: 403 })) as unknown as typeof fetch;
  assert.equal(await jobFailedSteps(env, 'token', forbidden), null);
  assert.equal(await jobFailedSteps({ ...env, RUNNER_NAME: undefined }, 'token', forbidden), null);
});
