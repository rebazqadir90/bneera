import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers/testServer.js';
import { createCookieJar } from './helpers/cookieJar.js';

let server;
const ADMIN_EMAIL = `admin-${Date.now()}@example.com`;
before(async () => {
  server = await startTestServer({ adminEmails: [ADMIN_EMAIL.toLowerCase()] });
  const jar = createCookieJar(server.baseUrl);
  await jar.fetch('/api/signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fullName: 'Admin', email: ADMIN_EMAIL, password: 'password123', confirmPassword: 'password123', agree: true })
  });
});
after(async () => { await server.close(); });

function uniqueEmail(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function newUser(prefix, email) {
  const jar = createCookieJar(server.baseUrl);
  await jar.fetch('/api/signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fullName: prefix, email, password: 'password123', confirmPassword: 'password123', agree: true })
  });
  return jar;
}

async function adminJar() {
  const jar = createCookieJar(server.baseUrl);
  await jar.fetch('/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: 'password123' })
  });
  return jar;
}

test('admin users list: requires authentication', async () => {
  const jar = createCookieJar(server.baseUrl);
  const res = await jar.fetch('/api/admin/users');
  assert.equal(res.status, 401);
});

test('admin users list: rejects non-admin with 403', async () => {
  const jar = await newUser('plain', uniqueEmail('plain'));
  const res = await jar.fetch('/api/admin/users');
  assert.equal(res.status, 403);
});

test('admin users list: admin sees all registered accounts with correct count', async () => {
  await newUser('u1', uniqueEmail('list1'));
  await newUser('u2', uniqueEmail('list2'));
  const jar = await adminJar();
  const res = await jar.fetch('/api/admin/users');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.count, body.users.length);
  assert.ok(body.users.length >= 3); // at least the admin + the two just created
  assert.ok(body.users.every(u => u.passwordHash === undefined), 'password hash must never be exposed');
});

test('admin orders list: requires authentication', async () => {
  const jar = createCookieJar(server.baseUrl);
  const res = await jar.fetch('/api/admin/orders');
  assert.equal(res.status, 401);
});

test('admin orders list: rejects non-admin with 403', async () => {
  const jar = await newUser('plain2', uniqueEmail('plain2'));
  const res = await jar.fetch('/api/admin/orders');
  assert.equal(res.status, 403);
});

test('admin orders list: shows orders from ALL users with owner info attached', async () => {
  const ownerJar = await newUser('owner', uniqueEmail('adminlist-owner'));
  const form = new FormData();
  form.append('link', 'https://example.com/admin-visible');
  const createRes = await ownerJar.fetch('/api/orders', { method: 'POST', body: form });
  const created = (await createRes.json()).order;

  const jar = await adminJar();
  const res = await jar.fetch('/api/admin/orders');
  assert.equal(res.status, 200);
  const body = await res.json();
  const found = body.orders.find(o => o.id === created.id);
  assert.ok(found, 'admin must see the order created by another user');
  assert.ok(found.ownerEmail, 'owner email must be attached');
});
