import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers/testServer.js';
import { createCookieJar } from './helpers/cookieJar.js';

let server;
const ADMIN_EMAIL = `admin-details-${Date.now()}@example.com`;
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

async function createOrder(jar, link = 'https://example.com/p') {
  const form = new FormData();
  form.append('link', link);
  form.append('quantity', '2');
  const res = await jar.fetch('/api/orders', { method: 'POST', body: form });
  return (await res.json()).order;
}

test('order details: requires authentication', async () => {
  const jar = createCookieJar(server.baseUrl);
  const res = await jar.fetch('/api/orders/SOMEID/details', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ weight: 2 })
  });
  assert.equal(res.status, 401);
});

test('order details: non-admin gets 403', async () => {
  const jar = await newUser('nonadmin-details');
  const order = await createOrder(jar);
  const res = await jar.fetch(`/api/orders/${order.id}/details`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ weight: 2 })
  });
  assert.equal(res.status, 403);
});

test('order details: admin can set weight, price, taxRate, shipping; tax $ is derived as price*qty*rate/100', async () => {
  const ownerJar = await newUser('owner-details');
  const order = await createOrder(ownerJar); // quantity 2
  const admin = await adminJar();

  const res = await admin.fetch(`/api/orders/${order.id}/details`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ weight: 1.5, price: 25, taxRate: 10, shipping: 8 })
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.order.weight, 1.5);
  assert.equal(body.order.price, 25);
  assert.equal(body.order.taxRate, 10);
  assert.equal(body.order.tax, 25 * 2 * 0.10); // price * quantity * rate
  assert.equal(body.order.shipping, 8);

  const verify = await ownerJar.fetch(`/api/orders/${order.id}`);
  const verifyBody = await verify.json();
  assert.equal(verifyBody.order.price, 25);
});

test('order details: changing price alone recalculates the derived tax $ using the existing rate', async () => {
  const ownerJar = await newUser('owner-recalc');
  const order = await createOrder(ownerJar); // quantity 2
  const admin = await adminJar();

  await admin.fetch(`/api/orders/${order.id}/details`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ price: 10, taxRate: 20 })
  });
  const res = await admin.fetch(`/api/orders/${order.id}/details`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ price: 50 })
  });
  const body = await res.json();
  assert.equal(body.order.price, 50);
  assert.equal(body.order.taxRate, 20, 'tax rate should be unchanged');
  assert.equal(body.order.tax, 50 * 2 * 0.20, 'tax $ should recompute from the new price using the existing rate');
});

test('order details: partial update only changes the provided field (weight/shipping untouched)', async () => {
  const ownerJar = await newUser('owner-partial');
  const order = await createOrder(ownerJar);
  const admin = await adminJar();

  await admin.fetch(`/api/orders/${order.id}/details`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ weight: 3, price: 10, taxRate: 5, shipping: 2 })
  });
  const res = await admin.fetch(`/api/orders/${order.id}/details`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ price: 99.5 })
  });
  const body = await res.json();
  assert.equal(body.order.price, 99.5);
  assert.equal(body.order.weight, 3, 'weight should be unchanged by a price-only update');
  assert.equal(body.order.taxRate, 5, 'tax rate should be unchanged');
  assert.equal(body.order.shipping, 2, 'shipping should be unchanged');
});

test('order details: rejects a tax rate over 100%', async () => {
  const ownerJar = await newUser('owner-taxover');
  const order = await createOrder(ownerJar);
  const admin = await adminJar();
  const res = await admin.fetch(`/api/orders/${order.id}/details`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taxRate: 150 })
  });
  assert.equal(res.status, 400);
});

test('order details: rejects a negative tax rate', async () => {
  const ownerJar = await newUser('owner-negtaxrate');
  const order = await createOrder(ownerJar);
  const admin = await adminJar();
  const res = await admin.fetch(`/api/orders/${order.id}/details`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taxRate: -5 })
  });
  assert.equal(res.status, 400);
});

test('order details: rejects negative price', async () => {
  const ownerJar = await newUser('owner-negprice');
  const order = await createOrder(ownerJar);
  const admin = await adminJar();
  const res = await admin.fetch(`/api/orders/${order.id}/details`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ price: -5 })
  });
  assert.equal(res.status, 400);
});

test('order details: rejects negative weight', async () => {
  const ownerJar = await newUser('owner-negweight');
  const order = await createOrder(ownerJar);
  const admin = await adminJar();
  const res = await admin.fetch(`/api/orders/${order.id}/details`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ weight: -1 })
  });
  assert.equal(res.status, 400);
});

test('order details: rejects non-numeric shipping', async () => {
  const ownerJar = await newUser('owner-badship');
  const order = await createOrder(ownerJar);
  const admin = await adminJar();
  const res = await admin.fetch(`/api/orders/${order.id}/details`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shipping: 'not-a-number' })
  });
  assert.equal(res.status, 400);
});

test('order details: 404 for nonexistent order', async () => {
  const admin = await adminJar();
  const res = await admin.fetch('/api/orders/DOESNOTEXIST/details', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ price: 5 })
  });
  assert.equal(res.status, 404);
});

test('order details: total in list response reflects price*qty + derived tax + shipping', async () => {
  const ownerJar = await newUser('owner-total');
  const order = await createOrder(ownerJar); // quantity 2
  const admin = await adminJar();
  await admin.fetch(`/api/orders/${order.id}/details`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ price: 10, taxRate: 5, shipping: 3 })
  });
  const res = await ownerJar.fetch(`/api/orders/${order.id}`);
  const body = await res.json();
  const expectedTax = 10 * 2 * 0.05;
  const expectedTotal = 10 * 2 + expectedTax + 3;
  const actualTotal = body.order.price * body.order.quantity + body.order.tax + body.order.shipping;
  assert.equal(actualTotal, expectedTotal);
});

test('order details: zero values are accepted (clearing a field back to 0)', async () => {
  const ownerJar = await newUser('owner-zero');
  const order = await createOrder(ownerJar);
  const admin = await adminJar();
  await admin.fetch(`/api/orders/${order.id}/details`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ price: 20 })
  });
  const res = await admin.fetch(`/api/orders/${order.id}/details`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ price: 0 })
  });
  const body = await res.json();
  assert.equal(body.order.price, 0);
});
