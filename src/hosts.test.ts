import assert from 'node:assert/strict';
import { test } from 'node:test';
import { laneHostnames, withBlock, withoutBlock } from './hosts.ts';

test('hostnames come from the https URLs of services and containers', () => {
  const hosts = laneHostnames({
    reference: 'acme@1',
    index: 1,
    units: [
      {
        name: 'api',
        state: 'idle',
        urls: [
          'http://127.0.0.1:20000',
          'https://api.acme-1.localhost',
          'https://admin.acme-1.localhost:8443'
        ]
      },
      { name: 'worker', state: 'idle', urls: ['http://127.0.0.1:20001'] }
    ],
    containers: [{ name: 'mailpit', urls: ['https://mail.acme-1.localhost'] }]
  });
  assert.deepEqual(hosts, [
    'admin.acme-1.localhost',
    'api.acme-1.localhost',
    'mail.acme-1.localhost'
  ]);
  assert.deepEqual(laneHostnames(undefined), []);
});

test('the block is appended once and replaced on the next write', () => {
  const original = '# Copyright (c) Microsoft\r\n127.0.0.1 localhost\r\n';
  const first = withBlock(original, ['api.acme.localhost']);
  assert.equal(
    first,
    '# Copyright (c) Microsoft\r\n127.0.0.1 localhost\r\n# devlanes action begin\r\n127.0.0.1 api.acme.localhost\r\n# devlanes action end\r\n'
  );
  const second = withBlock(first, ['web.acme.localhost']);
  assert.equal(second.match(/devlanes action begin/g)?.length, 1);
  assert.match(second, /127\.0\.0\.1 web\.acme\.localhost/);
  assert.doesNotMatch(second, /api\.acme\.localhost/);
});

test('removing the block leaves the rest of the file as it was', () => {
  const original = '127.0.0.1 localhost\r\n';
  assert.equal(withoutBlock(withBlock(original, ['api.acme.localhost'])), original);
  assert.equal(withoutBlock(original), original);
  assert.equal(
    withBlock('', ['a.localhost']),
    '# devlanes action begin\r\n127.0.0.1 a.localhost\r\n# devlanes action end\r\n'
  );
});
