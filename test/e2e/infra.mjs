// Checks the infra fixture: the container output, a service reaching the container by port, the
// container's hostname through the proxy, and Chromium trusting the CA through the NSS store.

import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const infra = JSON.parse(process.env.INFRA ?? '{}');
const urls = JSON.parse(process.env.URLS ?? '{}');

assert.ok(infra.whoami, `whoami in the infra output: ${process.env.INFRA}`);
assert.ok(Object.values(infra.whoami.ports).length > 0, 'whoami has a host port');

const viaService = await fetch(`${urls.api}/whoami`, { signal: AbortSignal.timeout(15_000) });
assert.deepEqual(await viaService.json(), { path: '/whoami', whoami: 200 });

const domain = process.env.DOMAIN;
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  // A certificate the browser does not trust makes goto throw ERR_CERT_AUTHORITY_INVALID.
  const response = await page.goto(`https://whoami.${domain}/`);
  assert.equal(response?.status(), 200);
  assert.match(await page.content(), /Hostname:/);
} finally {
  await browser.close();
}

console.log(`ok: https://whoami.${domain}/ in Chromium`);
