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

async function newLoggedInUser(prefix) {
  const jar = createCookieJar(server.baseUrl);
  const email = uniqueEmail(prefix);
  await jar.fetch('/api/signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fullName: prefix, email, password: 'password123', confirmPassword: 'password123', agree: true })
  });
  return jar;
}

test('orders: GET without a session returns 401', async () => {
  const jar = createCookieJar(server.baseUrl);
  const res = await jar.fetch('/api/orders');
  assert.equal(res.status, 401);
});

test('orders: POST without a session returns 401', async () => {
  const jar = createCookieJar(server.baseUrl);
  const form = new FormData();
  form.append('link', 'https://example.com/product/1');
  const res = await jar.fetch('/api/orders', { method: 'POST', body: form });
  assert.equal(res.status, 401);
});

test('orders: logged-in user with no orders gets an empty array', async () => {
  const jar = await newLoggedInUser('empty');
  const res = await jar.fetch('/api/orders');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.orders, []);
});

test('orders: create with only the required link field succeeds, defaults applied', async () => {
  const jar = await newLoggedInUser('minimal');
  const form = new FormData();
  form.append('link', 'https://example.com/product/2');
  const res = await jar.fetch('/api/orders', { method: 'POST', body: form });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.order.status, 'Pending');
  assert.equal(body.order.quantity, 1);
  assert.equal(body.order.size, '');
  assert.equal(body.order.color, '');
  assert.equal(body.order.image, '');
  assert.equal(body.order.price, 0);
});

test('orders: create with all fields populated round-trips correctly', async () => {
  const jar = await newLoggedInUser('full');
  const form = new FormData();
  form.append('link', 'https://example.com/product/3');
  form.append('quantity', '4');
  form.append('size', 'XL');
  form.append('color', 'Red');
  form.append('note', 'Gift wrap please');
  const res = await jar.fetch('/api/orders', { method: 'POST', body: form });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.order.quantity, 4);
  assert.equal(body.order.size, 'XL');
  assert.equal(body.order.color, 'Red');
  assert.equal(body.order.note, 'Gift wrap please');
});

test('orders: rejects missing link', async () => {
  const jar = await newLoggedInUser('nolink');
  const form = new FormData();
  form.append('quantity', '1');
  const res = await jar.fetch('/api/orders', { method: 'POST', body: form });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.error.fields.link);
});

test('orders: rejects a link that is not a valid URL', async () => {
  const jar = await newLoggedInUser('badlink');
  const form = new FormData();
  form.append('link', 'not a url at all');
  const res = await jar.fetch('/api/orders', { method: 'POST', body: form });
  assert.equal(res.status, 400);
});

test('orders: rejects zero quantity', async () => {
  const jar = await newLoggedInUser('zeroqty');
  const form = new FormData();
  form.append('link', 'https://example.com/p');
  form.append('quantity', '0');
  const res = await jar.fetch('/api/orders', { method: 'POST', body: form });
  assert.equal(res.status, 400);
});

test('orders: rejects negative quantity', async () => {
  const jar = await newLoggedInUser('negqty');
  const form = new FormData();
  form.append('link', 'https://example.com/p');
  form.append('quantity', '-3');
  const res = await jar.fetch('/api/orders', { method: 'POST', body: form });
  assert.equal(res.status, 400);
});

test('orders: rejects non-integer quantity', async () => {
  const jar = await newLoggedInUser('floatqty');
  const form = new FormData();
  form.append('link', 'https://example.com/p');
  form.append('quantity', '2.5');
  const res = await jar.fetch('/api/orders', { method: 'POST', body: form });
  assert.equal(res.status, 400);
});

test('orders: rejects note longer than 1000 characters', async () => {
  const jar = await newLoggedInUser('longnote');
  const form = new FormData();
  form.append('link', 'https://example.com/p');
  form.append('note', 'x'.repeat(1001));
  const res = await jar.fetch('/api/orders', { method: 'POST', body: form });
  assert.equal(res.status, 400);
});

test('orders: created order appears in the list afterward', async () => {
  const jar = await newLoggedInUser('appears');
  const form = new FormData();
  form.append('link', 'https://example.com/p');
  const createRes = await jar.fetch('/api/orders', { method: 'POST', body: form });
  const created = (await createRes.json()).order;

  const listRes = await jar.fetch('/api/orders');
  const list = (await listRes.json()).orders;
  assert.ok(list.some(o => o.id === created.id));
});

test('orders: GET /api/orders/:id returns the correct single order for its owner', async () => {
  const jar = await newLoggedInUser('single');
  const form = new FormData();
  form.append('link', 'https://example.com/single');
  const createRes = await jar.fetch('/api/orders', { method: 'POST', body: form });
  const created = (await createRes.json()).order;

  const res = await jar.fetch(`/api/orders/${created.id}`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.order.id, created.id);
  assert.equal(body.order.link, 'https://example.com/single');
});

test('orders: GET /api/orders/:id returns 404 for a nonexistent id', async () => {
  const jar = await newLoggedInUser('missing');
  const res = await jar.fetch('/api/orders/DOES-NOT-EXIST');
  assert.equal(res.status, 404);
});

test('multi-tenant isolation: user A never sees user B\'s orders in the list', async () => {
  const jarA = await newLoggedInUser('tenantA');
  const jarB = await newLoggedInUser('tenantB');

  const formA = new FormData();
  formA.append('link', 'https://example.com/a-only');
  const createA = await jarA.fetch('/api/orders', { method: 'POST', body: formA });
  const orderA = (await createA.json()).order;

  const formB = new FormData();
  formB.append('link', 'https://example.com/b-only');
  await jarB.fetch('/api/orders', { method: 'POST', body: formB });

  const listA = (await (await jarA.fetch('/api/orders')).json()).orders;
  const listB = (await (await jarB.fetch('/api/orders')).json()).orders;

  assert.ok(listA.some(o => o.id === orderA.id));
  assert.ok(!listB.some(o => o.id === orderA.id), 'user B must not see user A\'s order');
});

test('multi-tenant isolation: user B gets 404 (not 403) fetching user A\'s order by id', async () => {
  const jarA = await newLoggedInUser('ownerA');
  const jarB = await newLoggedInUser('otherB');

  const form = new FormData();
  form.append('link', 'https://example.com/private');
  const createRes = await jarA.fetch('/api/orders', { method: 'POST', body: form });
  const order = (await createRes.json()).order;

  const res = await jarB.fetch(`/api/orders/${order.id}`);
  assert.equal(res.status, 404);
});

test('data consistency: day/time fields are computed and present on every returned order', async () => {
  const jar = await newLoggedInUser('daytime');
  const form = new FormData();
  form.append('link', 'https://example.com/p');
  const res = await jar.fetch('/api/orders', { method: 'POST', body: form });
  const order = (await res.json()).order;
  assert.ok(order.day && order.day.length > 0);
  assert.ok(order.time && order.time.length > 0);
});

test('data consistency: order id format matches the frontend convention (uppercase base36)', async () => {
  const jar = await newLoggedInUser('idformat');
  const form = new FormData();
  form.append('link', 'https://example.com/p');
  const res = await jar.fetch('/api/orders', { method: 'POST', body: form });
  const order = (await res.json()).order;
  assert.match(order.id, /^[0-9A-Z]+$/);
});

test('permission: PATCH status by a non-admin user is rejected with 403', async () => {
  const jar = await newLoggedInUser('nonadmin');
  const form = new FormData();
  form.append('link', 'https://example.com/p');
  const createRes = await jar.fetch('/api/orders', { method: 'POST', body: form });
  const order = (await createRes.json()).order;

  const res = await jar.fetch(`/api/orders/${order.id}/status`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'Delivered' })
  });
  assert.equal(res.status, 403);
});

test('performance: listing 50 orders for one user completes and returns all 50', async () => {
  const jar = await newLoggedInUser('bulk');
  for (let i = 0; i < 50; i++) {
    const form = new FormData();
    form.append('link', `https://example.com/bulk/${i}`);
    // eslint-disable-next-line no-await-in-loop
    const res = await jar.fetch('/api/orders', { method: 'POST', body: form });
    assert.equal(res.status, 201);
  }
  const start = Date.now();
  const res = await jar.fetch('/api/orders');
  const elapsedMs = Date.now() - start;
  const body = await res.json();
  assert.equal(body.orders.length, 50);
  assert.ok(elapsedMs < 2000, `expected list under 2s, took ${elapsedMs}ms`);
});
