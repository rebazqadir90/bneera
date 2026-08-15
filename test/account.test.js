import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startTestServer } from './helpers/testServer.js';
import { createCookieJar } from './helpers/cookieJar.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PNG = fs.readFileSync(path.join(__dirname, 'fixtures', 'tiny.png'));

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

// --- avatar ---

test('avatar: requires authentication', async () => {
  const jar = createCookieJar(server.baseUrl);
  const form = new FormData();
  form.append('avatar', new Blob([FIXTURE_PNG], { type: 'image/png' }), 'a.png');
  const res = await jar.fetch('/api/me/avatar', { method: 'POST', body: form });
  assert.equal(res.status, 401);
});

test('avatar: uploading a valid image sets user.avatar to a /uploads path', async () => {
  const { jar } = await newUser('avatar-ok');
  const form = new FormData();
  form.append('avatar', new Blob([FIXTURE_PNG], { type: 'image/png' }), 'a.png');
  const res = await jar.fetch('/api/me/avatar', { method: 'POST', body: form });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.match(body.user.avatar, /^\/uploads\/.+\.png$/);
});

test('avatar: reflected immediately on GET /api/me', async () => {
  const { jar } = await newUser('avatar-me');
  const form = new FormData();
  form.append('avatar', new Blob([FIXTURE_PNG], { type: 'image/png' }), 'a.png');
  await jar.fetch('/api/me/avatar', { method: 'POST', body: form });
  const res = await jar.fetch('/api/me');
  const body = await res.json();
  assert.match(body.user.avatar, /^\/uploads\//);
});

test('avatar: rejects request with no file', async () => {
  const { jar } = await newUser('avatar-nofile');
  const form = new FormData();
  const res = await jar.fetch('/api/me/avatar', { method: 'POST', body: form });
  assert.equal(res.status, 400);
});

test('avatar: rejects an unsupported file type', async () => {
  const { jar } = await newUser('avatar-badtype');
  const form = new FormData();
  form.append('avatar', new Blob([Buffer.from('not an image')], { type: 'text/plain' }), 'note.txt');
  const res = await jar.fetch('/api/me/avatar', { method: 'POST', body: form });
  assert.equal(res.status, 400);
});

test('new users have an empty avatar by default', async () => {
  const { jar } = await newUser('avatar-default');
  const res = await jar.fetch('/api/me');
  const body = await res.json();
  assert.equal(body.user.avatar, '');
});

// --- change password ---

test('change-password: requires authentication', async () => {
  const jar = createCookieJar(server.baseUrl);
  const res = await jar.fetch('/api/me/change-password', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword: 'x', newPassword: 'newPassword1', confirmNewPassword: 'newPassword1' })
  });
  assert.equal(res.status, 401);
});

test('change-password: succeeds with the correct current password, new password works on next login', async () => {
  const { jar, email } = await newUser('pw-change', 'oldPassword1');
  const res = await jar.fetch('/api/me/change-password', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword: 'oldPassword1', newPassword: 'newPassword1', confirmNewPassword: 'newPassword1' })
  });
  assert.equal(res.status, 200);

  const loginJar = createCookieJar(server.baseUrl);
  const loginRes = await loginJar.fetch('/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'newPassword1' })
  });
  assert.equal(loginRes.status, 200);
});

test('change-password: rejects an incorrect current password', async () => {
  const { jar } = await newUser('pw-wrong', 'oldPassword1');
  const res = await jar.fetch('/api/me/change-password', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword: 'totallyWrong', newPassword: 'newPassword1', confirmNewPassword: 'newPassword1' })
  });
  assert.equal(res.status, 400);
});

test('change-password: rejects a new password under 8 characters', async () => {
  const { jar } = await newUser('pw-short', 'oldPassword1');
  const res = await jar.fetch('/api/me/change-password', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword: 'oldPassword1', newPassword: 'short1', confirmNewPassword: 'short1' })
  });
  assert.equal(res.status, 400);
});

test('change-password: rejects mismatched confirmNewPassword', async () => {
  const { jar } = await newUser('pw-mismatch', 'oldPassword1');
  const res = await jar.fetch('/api/me/change-password', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword: 'oldPassword1', newPassword: 'newPassword1', confirmNewPassword: 'differentPassword1' })
  });
  assert.equal(res.status, 400);
});

test('change-password: signs out other sessions but keeps the current one active', async () => {
  const { jar: sessionA, email } = await newUser('pw-sessions', 'oldPassword1');
  const sessionB = createCookieJar(server.baseUrl);
  await sessionB.fetch('/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'oldPassword1' })
  });

  await sessionA.fetch('/api/me/change-password', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword: 'oldPassword1', newPassword: 'newPassword1', confirmNewPassword: 'newPassword1' })
  });

  const meA = await (await sessionA.fetch('/api/me')).json();
  assert.equal(meA.user.email, email, 'the session that made the change should stay logged in');

  const meB = await (await sessionB.fetch('/api/me')).json();
  assert.equal(meB.user, null, 'other sessions must be signed out after a password change');
});

// --- address (PATCH /api/me/shipping) ---

test('address: requires authentication', async () => {
  const jar = createCookieJar(server.baseUrl);
  const res = await jar.fetch('/api/me/shipping', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName: 'A', lastName: 'B', address: 'x', city: 'y', phone: '123' })
  });
  assert.equal(res.status, 401);
});

test('address: valid update is saved and reflected on GET', async () => {
  const { jar } = await newUser('addr-ok');
  const res = await jar.fetch('/api/me/shipping', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName: 'Ada', lastName: 'Lovelace', address: '1 Main St', city: 'Erbil', phone: '0750123', phone2: '' })
  });
  assert.equal(res.status, 200);

  const getRes = await jar.fetch('/api/me/shipping', { credentials: 'same-origin' });
  const body = await getRes.json();
  assert.equal(body.shipping.city, 'Erbil');
});

test('address: rejects missing required field', async () => {
  const { jar } = await newUser('addr-missing');
  const res = await jar.fetch('/api/me/shipping', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName: '', lastName: 'B', address: 'x', city: 'y', phone: '123' })
  });
  assert.equal(res.status, 400);
});

test('address: can be edited directly without an order (not only via order confirm)', async () => {
  const { jar } = await newUser('addr-direct');
  const before = await (await jar.fetch('/api/me/shipping', { credentials: 'same-origin' })).json();
  assert.equal(before.shipping, null);

  const res = await jar.fetch('/api/me/shipping', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName: 'A', lastName: 'B', address: 'x', city: 'y', phone: '123', phone2: '' })
  });
  assert.equal(res.status, 200);
});
