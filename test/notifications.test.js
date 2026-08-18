import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers/testServer.js';
import { createCookieJar } from './helpers/cookieJar.js';

let server;
const ADMIN_EMAIL = `admin-notif-${Date.now()}@example.com`;
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

async function newUser(prefix) {
  const jar = createCookieJar(server.baseUrl);
  await jar.fetch('/api/signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fullName: prefix, email: uniqueEmail(prefix), password: 'password123', confirmPassword: 'password123', agree: true })
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

async function createOrder(jar) {
  const form = new FormData();
  form.append('link', 'https://example.com/p');
  const res = await jar.fetch('/api/orders', { method: 'POST', body: form });
  return (await res.json()).order;
}

async function setStatus(id, status) {
  const admin = await adminJar();
  await admin.fetch(`/api/orders/${id}/status`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status })
  });
}

const VALID_SHIPPING = {
  firstName: 'Ada', lastName: 'Lovelace', address: '123 Main St',
  city: 'Erbil', phone: '0750123', phone2: ''
};

test('notifications: requires authentication', async () => {
  const jar = createCookieJar(server.baseUrl);
  const res = await jar.fetch('/api/notifications');
  assert.equal(res.status, 401);
});

test('notifications: empty list and 0 unread for a new user', async () => {
  const jar = await newUser('notif-empty');
  const res = await jar.fetch('/api/notifications');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.notifications, []);
  assert.equal(body.unreadCount, 0);
});

test('notifications: admin changing order status creates a notification for the owner', async () => {
  const jar = await newUser('notif-adminstatus');
  const order = await createOrder(jar);
  await setStatus(order.id, 'Processed');

  const res = await jar.fetch('/api/notifications');
  const body = await res.json();
  assert.equal(body.notifications.length, 1);
  assert.match(body.notifications[0].message, /Pending to Processed/);
  assert.equal(body.notifications[0].orderId, order.id);
  assert.equal(body.unreadCount, 1);
});

test('notifications: setting status to the SAME value does not create a duplicate notification', async () => {
  const jar = await newUser('notif-samestatus');
  const order = await createOrder(jar);
  await setStatus(order.id, 'Pending'); // already Pending, no real change

  const res = await jar.fetch('/api/notifications');
  const body = await res.json();
  assert.equal(body.notifications.length, 0);
});

test('notifications: customer confirming an order creates a notification', async () => {
  const jar = await newUser('notif-confirm');
  const order = await createOrder(jar);
  await setStatus(order.id, 'Processed');

  await jar.fetch(`/api/orders/${order.id}/confirm`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(VALID_SHIPPING)
  });

  const res = await jar.fetch('/api/notifications');
  const body = await res.json();
  var confirmNotif = body.notifications.find(function(n){ return /to Confirmed/.test(n.message); });
  assert.ok(confirmNotif, 'expected a notification about the Confirmed transition');
});

test('notifications: customer canceling an order creates a notification', async () => {
  const jar = await newUser('notif-cancel');
  const order = await createOrder(jar);
  await jar.fetch(`/api/orders/${order.id}/cancel`, { method: 'PATCH' });

  const res = await jar.fetch('/api/notifications');
  const body = await res.json();
  var cancelNotif = body.notifications.find(function(n){ return /to Canceled/.test(n.message); });
  assert.ok(cancelNotif, 'expected a notification about the Canceled transition');
});

test('notifications: multiple status changes accumulate multiple notifications, newest first', async () => {
  const jar = await newUser('notif-multi');
  const order = await createOrder(jar);
  await setStatus(order.id, 'Processed');
  await setStatus(order.id, 'Confirmed');
  await setStatus(order.id, 'Purchased');

  const res = await jar.fetch('/api/notifications');
  const body = await res.json();
  assert.equal(body.notifications.length, 3);
  assert.match(body.notifications[0].message, /to Purchased/, 'most recent should be first');
  assert.match(body.notifications[2].message, /to Processed/, 'oldest should be last');
});

test('notifications: are scoped per user, not visible to other users', async () => {
  const ownerJar = await newUser('notif-owner');
  const otherJar = await newUser('notif-stranger');
  const order = await createOrder(ownerJar);
  await setStatus(order.id, 'Processed');

  const otherRes = await otherJar.fetch('/api/notifications');
  const otherBody = await otherRes.json();
  assert.equal(otherBody.notifications.length, 0);
});

test('notifications: mark one as read updates unreadCount', async () => {
  const jar = await newUser('notif-markone');
  const order = await createOrder(jar);
  await setStatus(order.id, 'Processed');

  const before = await (await jar.fetch('/api/notifications')).json();
  assert.equal(before.unreadCount, 1);
  const notifId = before.notifications[0].id;

  const markRes = await jar.fetch(`/api/notifications/${notifId}/read`, { method: 'POST' });
  assert.equal(markRes.status, 200);

  const after = await (await jar.fetch('/api/notifications')).json();
  assert.equal(after.unreadCount, 0);
  assert.equal(after.notifications[0].read, true);
});

test('notifications: mark-all-read clears unreadCount for multiple notifications', async () => {
  const jar = await newUser('notif-markall');
  const order = await createOrder(jar);
  await setStatus(order.id, 'Processed');
  await setStatus(order.id, 'Confirmed');
  await setStatus(order.id, 'Purchased');

  const before = await (await jar.fetch('/api/notifications')).json();
  assert.equal(before.unreadCount, 3);

  await jar.fetch('/api/notifications/read-all', { method: 'POST' });

  const after = await (await jar.fetch('/api/notifications')).json();
  assert.equal(after.unreadCount, 0);
  assert.ok(after.notifications.every(function(n){ return n.read === true; }));
});

test('notifications: a user cannot mark another user\'s notification as read', async () => {
  const ownerJar = await newUser('notif-secowner');
  const otherJar = await newUser('notif-secstranger');
  const order = await createOrder(ownerJar);
  await setStatus(order.id, 'Processed');

  const ownerBefore = await (await ownerJar.fetch('/api/notifications')).json();
  const notifId = ownerBefore.notifications[0].id;

  await otherJar.fetch(`/api/notifications/${notifId}/read`, { method: 'POST' });

  const ownerAfter = await (await ownerJar.fetch('/api/notifications')).json();
  assert.equal(ownerAfter.unreadCount, 1, 'another user marking-read must not affect the owner\'s notification');
});

test('mark-read/mark-all-read require authentication', async () => {
  const jar = createCookieJar(server.baseUrl);
  const res1 = await jar.fetch('/api/notifications/1/read', { method: 'POST' });
  assert.equal(res1.status, 401);
  const res2 = await jar.fetch('/api/notifications/read-all', { method: 'POST' });
  assert.equal(res2.status, 401);
});
