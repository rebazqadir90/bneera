import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers/testServer.js';
import { createCookieJar } from './helpers/cookieJar.js';

let server;
before(async () => { server = await startTestServer(); });
after(async () => { await server.close(); });

function uniqueEmail(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

test('leads: valid email is accepted with 201', async () => {
  const jar = createCookieJar(server.baseUrl);
  const res = await jar.fetch('/api/leads', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: uniqueEmail('lead') })
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.ok, true);
});

test('leads: does not require authentication (anonymous CTA capture)', async () => {
  const jar = createCookieJar(server.baseUrl);
  const res = await jar.fetch('/api/leads', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: uniqueEmail('anon') })
  });
  assert.equal(res.status, 201);
});

test('leads: rejects missing email field', async () => {
  const jar = createCookieJar(server.baseUrl);
  const res = await jar.fetch('/api/leads', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  assert.equal(res.status, 400);
});

test('leads: rejects empty string email', async () => {
  const jar = createCookieJar(server.baseUrl);
  const res = await jar.fetch('/api/leads', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: '' })
  });
  assert.equal(res.status, 400);
});

test('leads: rejects whitespace-only email', async () => {
  const jar = createCookieJar(server.baseUrl);
  const res = await jar.fetch('/api/leads', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: '   ' })
  });
  assert.equal(res.status, 400);
});

test('leads: rejects malformed email (no @)', async () => {
  const jar = createCookieJar(server.baseUrl);
  const res = await jar.fetch('/api/leads', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'not-an-email' })
  });
  assert.equal(res.status, 400);
});

test('leads: rejects malformed email (no domain)', async () => {
  const jar = createCookieJar(server.baseUrl);
  const res = await jar.fetch('/api/leads', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'user@' })
  });
  assert.equal(res.status, 400);
});

test('leads: rejects email exceeding 254 characters', async () => {
  const jar = createCookieJar(server.baseUrl);
  const longLocal = 'a'.repeat(250);
  const res = await jar.fetch('/api/leads', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `${longLocal}@example.com` })
  });
  assert.equal(res.status, 400);
});

test('leads: accepts email with a plus-tag (valid RFC pattern)', async () => {
  const jar = createCookieJar(server.baseUrl);
  const res = await jar.fetch('/api/leads', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `plus.tag+${Date.now()}@example.com` })
  });
  assert.equal(res.status, 201);
});

test('leads: same email can be submitted more than once (no uniqueness constraint expected)', async () => {
  const email = uniqueEmail('repeat');
  const jar1 = createCookieJar(server.baseUrl);
  const jar2 = createCookieJar(server.baseUrl);
  const res1 = await jar1.fetch('/api/leads', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email })
  });
  const res2 = await jar2.fetch('/api/leads', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email })
  });
  assert.equal(res1.status, 201);
  assert.equal(res2.status, 201);
});

test('leads: rejects non-string email (number)', async () => {
  const jar = createCookieJar(server.baseUrl);
  const res = await jar.fetch('/api/leads', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 12345 })
  });
  assert.equal(res.status, 400);
});

test('leads: rejects request with no body at all', async () => {
  const jar = createCookieJar(server.baseUrl);
  const res = await jar.fetch('/api/leads', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: ''
  });
  assert.equal(res.status, 400);
});

test('leads: does not leak DB errors as 500 for well-formed but unusual input (unicode local part)', async () => {
  const jar = createCookieJar(server.baseUrl);
  const res = await jar.fetch('/api/leads', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `üñïçødé-${Date.now()}@example.com` })
  });
  assert.ok(res.status === 201 || res.status === 400, `expected 201 or 400, got ${res.status}`);
});

test('leads: response has consistent {ok:true} shape', async () => {
  const jar = createCookieJar(server.baseUrl);
  const res = await jar.fetch('/api/leads', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: uniqueEmail('shape') })
  });
  const body = await res.json();
  assert.deepEqual(Object.keys(body), ['ok']);
});

test('leads: trims leading/trailing whitespace before validating', async () => {
  const jar = createCookieJar(server.baseUrl);
  const res = await jar.fetch('/api/leads', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `  ${uniqueEmail('trim')}  ` })
  });
  assert.equal(res.status, 201);
});
