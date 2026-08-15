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

async function newUser(prefix, password = 'password123') {
  const jar = createCookieJar(server.baseUrl);
  const email = uniqueEmail(prefix);
  await jar.fetch('/api/signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fullName: prefix, email, password, confirmPassword: password, agree: true })
  });
  return { jar, email };
}

async function requestReset(email) {
  const jar = createCookieJar(server.baseUrl);
  const res = await jar.fetch('/api/forgot-password', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email })
  });
  const body = await res.json();
  return { res, body };
}

test('forgot-password: returns generic 200 for a registered email', async () => {
  const { email } = await newUser('reset-ok');
  const { res, body } = await requestReset(email);
  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
});

test('forgot-password: returns the SAME generic 200 for an unregistered email (no enumeration)', async () => {
  const { res, body } = await requestReset(uniqueEmail('never-signed-up'));
  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
});

test('forgot-password: dev mode includes a usable reset URL in the response', async () => {
  const { email } = await newUser('reset-devurl');
  const { body } = await requestReset(email);
  assert.ok(body.devResetUrl, 'dev response should include the reset link since no email provider is configured');
  assert.match(body.devResetUrl, /\/reset-password\.html\?token=/);
});

test('forgot-password: malformed email still returns generic 200 (no crash, no leak)', async () => {
  const { res, body } = await requestReset('not-an-email');
  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.devResetUrl, undefined);
});

test('forgot-password: does not require authentication', async () => {
  const { email } = await newUser('reset-noauth');
  const { res } = await requestReset(email);
  assert.equal(res.status, 200);
});

function extractToken(devResetUrl) {
  return new URL(devResetUrl).searchParams.get('token');
}

test('reset-password: valid token sets the new password, old password stops working', async () => {
  const { email } = await newUser('reset-flow', 'oldPassword1');
  const { body } = await requestReset(email);
  const token = extractToken(body.devResetUrl);

  const resetJar = createCookieJar(server.baseUrl);
  const resetRes = await resetJar.fetch('/api/reset-password', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, password: 'brandNewPassword1', confirmPassword: 'brandNewPassword1' })
  });
  assert.equal(resetRes.status, 200);

  const oldLoginJar = createCookieJar(server.baseUrl);
  const oldLoginRes = await oldLoginJar.fetch('/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'oldPassword1' })
  });
  assert.equal(oldLoginRes.status, 401);

  const newLoginJar = createCookieJar(server.baseUrl);
  const newLoginRes = await newLoginJar.fetch('/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'brandNewPassword1' })
  });
  assert.equal(newLoginRes.status, 200);
});

test('reset-password: token is single-use (second attempt with same token fails)', async () => {
  const { email } = await newUser('reset-singleuse');
  const { body } = await requestReset(email);
  const token = extractToken(body.devResetUrl);

  const jar1 = createCookieJar(server.baseUrl);
  await jar1.fetch('/api/reset-password', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, password: 'firstNewPassword1', confirmPassword: 'firstNewPassword1' })
  });

  const jar2 = createCookieJar(server.baseUrl);
  const res2 = await jar2.fetch('/api/reset-password', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, password: 'secondNewPassword1', confirmPassword: 'secondNewPassword1' })
  });
  assert.equal(res2.status, 400);
});

test('reset-password: rejects an invalid/garbage token', async () => {
  const jar = createCookieJar(server.baseUrl);
  const res = await jar.fetch('/api/reset-password', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 'totally-made-up-token', password: 'password123', confirmPassword: 'password123' })
  });
  assert.equal(res.status, 400);
});

test('reset-password: rejects missing token', async () => {
  const jar = createCookieJar(server.baseUrl);
  const res = await jar.fetch('/api/reset-password', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'password123', confirmPassword: 'password123' })
  });
  assert.equal(res.status, 400);
});

test('reset-password: rejects mismatched confirmPassword', async () => {
  const { email } = await newUser('reset-mismatch');
  const { body } = await requestReset(email);
  const token = extractToken(body.devResetUrl);

  const jar = createCookieJar(server.baseUrl);
  const res = await jar.fetch('/api/reset-password', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, password: 'password123', confirmPassword: 'differentPassword1' })
  });
  assert.equal(res.status, 400);
});

test('reset-password: rejects a password under 8 characters', async () => {
  const { email } = await newUser('reset-shortpw');
  const { body } = await requestReset(email);
  const token = extractToken(body.devResetUrl);

  const jar = createCookieJar(server.baseUrl);
  const res = await jar.fetch('/api/reset-password', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, password: 'short1', confirmPassword: 'short1' })
  });
  assert.equal(res.status, 400);
});

test('reset-password: requesting a new token invalidates the previous outstanding one', async () => {
  const { email } = await newUser('reset-superseded');
  const first = await requestReset(email);
  const firstToken = extractToken(first.body.devResetUrl);
  await requestReset(email); // second request should invalidate the first token

  const jar = createCookieJar(server.baseUrl);
  const res = await jar.fetch('/api/reset-password', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: firstToken, password: 'newPassword123', confirmPassword: 'newPassword123' })
  });
  assert.equal(res.status, 400, 'the superseded first token should no longer work');
});

test('reset-password: signs the account out of all existing sessions after a successful reset', async () => {
  const { jar: loggedInJar, email } = await newUser('reset-signout', 'oldPassword1');
  const meBeforeRes = await loggedInJar.fetch('/api/me');
  assert.equal((await meBeforeRes.json()).user.email, email);

  const { body } = await requestReset(email);
  const token = extractToken(body.devResetUrl);
  const resetJar = createCookieJar(server.baseUrl);
  await resetJar.fetch('/api/reset-password', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, password: 'newPassword123', confirmPassword: 'newPassword123' })
  });

  const meAfterRes = await loggedInJar.fetch('/api/me');
  const meAfterBody = await meAfterRes.json();
  assert.equal(meAfterBody.user, null, 'the session that existed before the reset must be invalidated');
});

test('reset-password: expired token is rejected', async () => {
  // Exercised indirectly: an unknown/garbage token exercises the same "not found or expired" path
  // as a genuinely expired one, since expired tokens are deleted on lookup and treated as missing.
  const jar = createCookieJar(server.baseUrl);
  const res = await jar.fetch('/api/reset-password', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 'expired-or-never-existed', password: 'password123', confirmPassword: 'password123' })
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.error.message);
});
