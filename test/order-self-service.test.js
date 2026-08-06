import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers/testServer.js';
import { createCookieJar } from './helpers/cookieJar.js';

let server;
const ADMIN_EMAIL = `admin-selfsvc-${Date.now()}@example.com`;
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
  firstName: 'Ada', lastName: 'Lovelace', address: '123 Main St, Apt 4',
  city: 'Erbil', phone: '07501234567', phone2: ''
};

async function confirmOrder(jar, id, overrides) {
  return jar.fetch(`/api/orders/${id}/confirm`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.assign({}, VALID_SHIPPING, overrides))
  });
}

test('confirm: requires authentication', async () => {
  const jar = createCookieJar(server.baseUrl);
  const res = await jar.fetch('/api/orders/SOMEID/confirm', { method: 'PATCH' });
  assert.equal(res.status, 401);
});

test('confirm: cannot confirm a Pending order (409) — must be Processed first', async () => {
  const jar = await newUser('confirm-pending');
  const order = await createOrder(jar);
  const res = await confirmOrder(jar, order.id);
  assert.equal(res.status, 409);
});

test('confirm: owner can confirm a Processed order (with valid shipping details)', async () => {
  const jar = await newUser('confirm-processed');
  const order = await createOrder(jar);
  await setStatus(order.id, 'Processed');
  const res = await confirmOrder(jar, order.id);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.order.status, 'Confirmed');
  assert.deepEqual(body.order.shippingDetails, VALID_SHIPPING);
});

test('confirm: a different user (non-owner) gets 404, not the owner\'s order', async () => {
  const ownerJar = await newUser('confirm-owner');
  const otherJar = await newUser('confirm-stranger');
  const order = await createOrder(ownerJar);
  const res = await confirmOrder(otherJar, order.id);
  assert.equal(res.status, 404);
});

test('confirm: cannot confirm an already-Confirmed order (409)', async () => {
  const jar = await newUser('confirm-twice');
  const order = await createOrder(jar);
  await setStatus(order.id, 'Processed');
  await confirmOrder(jar, order.id);
  const res = await confirmOrder(jar, order.id);
  assert.equal(res.status, 409);
});

test('confirm: cannot confirm a Delivered order (409)', async () => {
  const jar = await newUser('confirm-delivered');
  const order = await createOrder(jar);
  await setStatus(order.id, 'Delivered');
  const res = await confirmOrder(jar, order.id);
  assert.equal(res.status, 409);
});

test('confirm: cannot confirm a Canceled order (409)', async () => {
  const jar = await newUser('confirm-canceled');
  const order = await createOrder(jar);
  await setStatus(order.id, 'Canceled');
  const res = await confirmOrder(jar, order.id);
  assert.equal(res.status, 409);
});

test('confirm: nonexistent order returns 404', async () => {
  const jar = await newUser('confirm-missing');
  const res = await confirmOrder(jar, 'NOPE123');
  assert.equal(res.status, 404);
});

test('confirm: rejects missing first name', async () => {
  const jar = await newUser('confirm-nofirst');
  const order = await createOrder(jar);
  await setStatus(order.id, 'Processed');
  const res = await confirmOrder(jar, order.id, { firstName: '' });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.error.fields.firstName);
});

test('confirm: rejects missing last name', async () => {
  const jar = await newUser('confirm-nolast');
  const order = await createOrder(jar);
  await setStatus(order.id, 'Processed');
  const res = await confirmOrder(jar, order.id, { lastName: '' });
  assert.equal(res.status, 400);
  assert.ok((await res.json()).error.fields.lastName);
});

test('confirm: rejects missing address', async () => {
  const jar = await newUser('confirm-noaddr');
  const order = await createOrder(jar);
  await setStatus(order.id, 'Processed');
  const res = await confirmOrder(jar, order.id, { address: '' });
  assert.equal(res.status, 400);
  assert.ok((await res.json()).error.fields.address);
});

test('confirm: rejects missing city', async () => {
  const jar = await newUser('confirm-nocity');
  const order = await createOrder(jar);
  await setStatus(order.id, 'Processed');
  const res = await confirmOrder(jar, order.id, { city: '' });
  assert.equal(res.status, 400);
  assert.ok((await res.json()).error.fields.city);
});

test('confirm: rejects missing phone', async () => {
  const jar = await newUser('confirm-nophone');
  const order = await createOrder(jar);
  await setStatus(order.id, 'Processed');
  const res = await confirmOrder(jar, order.id, { phone: '' });
  assert.equal(res.status, 400);
  assert.ok((await res.json()).error.fields.phone);
});

test('confirm: second phone number is optional', async () => {
  const jar = await newUser('confirm-nophone2');
  const order = await createOrder(jar);
  await setStatus(order.id, 'Processed');
  const res = await confirmOrder(jar, order.id, { phone2: '' });
  assert.equal(res.status, 200);
});

test('confirm: an unrelated order does not require shipping to be filled out to CREATE (only to confirm)', async () => {
  const jar = await newUser('confirm-createok');
  const order = await createOrder(jar); // creation never asked for shipping
  assert.equal(order.status, 'Pending');
});

test('shipping profile: GET /api/me/shipping is null before any order has been confirmed', async () => {
  const jar = await newUser('shipping-empty');
  const res = await jar.fetch('/api/me/shipping', { credentials: 'same-origin' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.shipping, null);
});

test('shipping profile: GET /api/me/shipping requires authentication', async () => {
  const jar = createCookieJar(server.baseUrl);
  const res = await jar.fetch('/api/me/shipping');
  assert.equal(res.status, 401);
});

test('shipping profile: confirming an order saves the profile for future reuse', async () => {
  const jar = await newUser('shipping-save');
  const order = await createOrder(jar);
  await setStatus(order.id, 'Processed');
  await confirmOrder(jar, order.id);

  const res = await jar.fetch('/api/me/shipping', { credentials: 'same-origin' });
  const body = await res.json();
  assert.deepEqual(body.shipping, VALID_SHIPPING);
});

test('shipping profile: a second order reuses and can update the saved profile', async () => {
  const jar = await newUser('shipping-reuse');
  const order1 = await createOrder(jar);
  await setStatus(order1.id, 'Processed');
  await confirmOrder(jar, order1.id);

  const order2 = await createOrder(jar);
  await setStatus(order2.id, 'Processed');
  await confirmOrder(jar, order2.id, { city: 'Baghdad' }); // customer corrects the city on the second order

  const profileRes = await jar.fetch('/api/me/shipping', { credentials: 'same-origin' });
  const profile = (await profileRes.json()).shipping;
  assert.equal(profile.city, 'Baghdad', 'profile should reflect the latest confirmed details');

  const order1Res = await jar.fetch(`/api/orders/${order1.id}`);
  const order1Body = await order1Res.json();
  assert.equal(order1Body.order.shippingDetails.city, 'Erbil', 'order 1\'s snapshot must NOT change retroactively');
});

test('shipping profile: is scoped per user, not shared across accounts', async () => {
  const jarA = await newUser('shipping-userA');
  const jarB = await newUser('shipping-userB');
  const orderA = await createOrder(jarA);
  await setStatus(orderA.id, 'Processed');
  await confirmOrder(jarA, orderA.id, { firstName: 'UserAFirst' });

  const profileB = await (await jarB.fetch('/api/me/shipping', { credentials: 'same-origin' })).json();
  assert.equal(profileB.shipping, null, 'user B must not see user A\'s saved shipping profile');
});

test('cancel: requires authentication', async () => {
  const jar = createCookieJar(server.baseUrl);
  const res = await jar.fetch('/api/orders/SOMEID/cancel', { method: 'PATCH' });
  assert.equal(res.status, 401);
});

test('cancel: owner can cancel a Pending order', async () => {
  const jar = await newUser('cancel-pending');
  const order = await createOrder(jar);
  const res = await jar.fetch(`/api/orders/${order.id}/cancel`, { method: 'PATCH' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.order.status, 'Canceled');
});

test('cancel: cannot cancel a Confirmed order (409) — no cancellation once confirmed', async () => {
  const jar = await newUser('cancel-confirmed');
  const order = await createOrder(jar);
  await setStatus(order.id, 'Processed');
  await confirmOrder(jar, order.id);
  const res = await jar.fetch(`/api/orders/${order.id}/cancel`, { method: 'PATCH' });
  assert.equal(res.status, 409);
});

test('cancel: owner can cancel a Processed order (still before confirmation)', async () => {
  const jar = await newUser('cancel-processed');
  const order = await createOrder(jar);
  await setStatus(order.id, 'Processed');
  const res = await jar.fetch(`/api/orders/${order.id}/cancel`, { method: 'PATCH' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.order.status, 'Canceled');
});

test('cancel: a different user (non-owner) gets 404', async () => {
  const ownerJar = await newUser('cancel-owner');
  const otherJar = await newUser('cancel-stranger');
  const order = await createOrder(ownerJar);
  const res = await otherJar.fetch(`/api/orders/${order.id}/cancel`, { method: 'PATCH' });
  assert.equal(res.status, 404);
});

test('cancel: cannot cancel an already-Canceled order (409)', async () => {
  const jar = await newUser('cancel-twice');
  const order = await createOrder(jar);
  await jar.fetch(`/api/orders/${order.id}/cancel`, { method: 'PATCH' });
  const res = await jar.fetch(`/api/orders/${order.id}/cancel`, { method: 'PATCH' });
  assert.equal(res.status, 409);
});

test('cancel: cannot cancel a Delivered order (409)', async () => {
  const jar = await newUser('cancel-delivered');
  const order = await createOrder(jar);
  await setStatus(order.id, 'Delivered');
  const res = await jar.fetch(`/api/orders/${order.id}/cancel`, { method: 'PATCH' });
  assert.equal(res.status, 409);
});

test('cancel: nonexistent order returns 404', async () => {
  const jar = await newUser('cancel-missing');
  const res = await jar.fetch('/api/orders/NOPE456/cancel', { method: 'PATCH' });
  assert.equal(res.status, 404);
});
