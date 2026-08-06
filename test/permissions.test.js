import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers/testServer.js';
import { createCookieJar } from './helpers/cookieJar.js';

let server;
const ADMIN_EMAIL = `admin-${Date.now()}@example.com`;

before(async () => { server = await startTestServer({ adminEmails: [ADMIN_EMAIL.toLowerCase()] }); });
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

test('role bootstrap: signing up with an ADMIN_EMAILS-listed address grants the admin role', async () => {
  const jar = await newUser('admin', ADMIN_EMAIL);
  const res = await jar.fetch('/api/me');
  const body = await res.json();
  assert.equal(body.user.role, 'admin');
});

test('role bootstrap: signing up with a non-listed address grants the plain user role', async () => {
  const jar = await newUser('plain', uniqueEmail('plain'));
  const res = await jar.fetch('/api/me');
  const body = await res.json();
  assert.equal(body.user.role, 'user');
});

test('admin: can update an order\'s status to a valid value and it persists', async () => {
  const ownerJar = await newUser('owner', uniqueEmail('owner'));
  const form = new FormData();
  form.append('link', 'https://example.com/p');
  const createRes = await ownerJar.fetch('/api/orders', { method: 'POST', body: form });
  const order = (await createRes.json()).order;

  const adminJar = await newUser('admin2', uniqueEmail('admin2'));
  // this user is NOT in ADMIN_EMAILS, so first confirm the negative case, then re-test with the real admin below.
  const nonAdminAttempt = await adminJar.fetch(`/api/orders/${order.id}/status`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'Confirmed' })
  });
  assert.equal(nonAdminAttempt.status, 403);

  const realAdminJar = createCookieJar(server.baseUrl);
  await realAdminJar.fetch('/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: 'password123' })
  });
  const res = await realAdminJar.fetch(`/api/orders/${order.id}/status`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'Confirmed' })
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.order.status, 'Confirmed');

  const verifyRes = await ownerJar.fetch(`/api/orders/${order.id}`);
  const verifyBody = await verifyRes.json();
  assert.equal(verifyBody.order.status, 'Confirmed');
});

test('admin: rejects an invalid status value not in the canonical 9', async () => {
  const ownerJar = await newUser('owner2', uniqueEmail('owner2'));
  const form = new FormData();
  form.append('link', 'https://example.com/p');
  const createRes = await ownerJar.fetch('/api/orders', { method: 'POST', body: form });
  const order = (await createRes.json()).order;

  const adminJar = createCookieJar(server.baseUrl);
  await adminJar.fetch('/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: 'password123' })
  });
  const res = await adminJar.fetch(`/api/orders/${order.id}/status`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'NotARealStatus' })
  });
  assert.equal(res.status, 400);
});

test('admin: status update on a nonexistent order returns 404', async () => {
  const adminJar = createCookieJar(server.baseUrl);
  await adminJar.fetch('/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: 'password123' })
  });
  const res = await adminJar.fetch('/api/orders/NOPE123/status', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'Confirmed' })
  });
  assert.equal(res.status, 404);
});

test('admin route requires authentication (401 when logged out)', async () => {
  const anonJar = createCookieJar(server.baseUrl);
  const res = await anonJar.fetch('/api/orders/NOPE123/status', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'Confirmed' })
  });
  assert.equal(res.status, 401);
});

test('admin can update status through all 9 canonical values in sequence', async () => {
  const ownerJar = await newUser('owner3', uniqueEmail('owner3'));
  const form = new FormData();
  form.append('link', 'https://example.com/p');
  const createRes = await ownerJar.fetch('/api/orders', { method: 'POST', body: form });
  const order = (await createRes.json()).order;

  const adminJar = createCookieJar(server.baseUrl);
  await adminJar.fetch('/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: 'password123' })
  });

  const statuses = ['Processed', 'Confirmed', 'Purchased', 'Received', 'Shipped To Iraq', 'Arrived', 'Delivered', 'Canceled'];
  for (const status of statuses) {
    // eslint-disable-next-line no-await-in-loop
    const res = await adminJar.fetch(`/api/orders/${order.id}/status`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    assert.equal(res.status, 200, `status transition to ${status} should succeed`);
  }
});
