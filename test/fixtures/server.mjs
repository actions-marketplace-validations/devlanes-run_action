// A service for the fixtures: answers with the request path, and on /whoami with what the
// container at WHOAMI_URL answers, so a test can see the service reach its infra.

import { createServer } from 'node:http';

const server = createServer(async (request, response) => {
  /** @type {{ path: string | undefined, whoami?: number }} */
  const body = { path: request.url };
  if (request.url === '/whoami' && process.env.WHOAMI_URL) {
    const answer = await fetch(process.env.WHOAMI_URL, { signal: AbortSignal.timeout(10_000) });
    body.whoami = answer.status;
  }
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
});

server.listen(Number(process.env.PORT), process.env.HOST ?? '127.0.0.1', () => {
  console.log(`listening on ${process.env.PORT}`);
});
