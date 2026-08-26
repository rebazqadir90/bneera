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

async function newLoggedInUser(prefix) {
  const jar = createCookieJar(server.baseUrl);
  const email = uniqueEmail(prefix);
  await jar.fetch('/api/signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fullName: prefix, email, password: 'password123', confirmPassword: 'password123', agree: true })
  });
  return jar;
}

test('upload: order created without an image has image === ""', async () => {
  const jar = await newLoggedInUser('noimg');
  const form = new FormData();
  form.append('link', 'https://example.com/p');
  const res = await jar.fetch('/api/orders', { method: 'POST', body: form });
  const order = (await res.json()).order;
  assert.equal(order.image, '');
});

test('upload: valid PNG upload is accepted and image URL is returned', async () => {
  const jar = await newLoggedInUser('png');
  const form = new FormData();
  form.append('link', 'https://example.com/p');
  form.append('image', new Blob([FIXTURE_PNG], { type: 'image/png' }), 'tiny.png');
  const res = await jar.fetch('/api/orders', { method: 'POST', body: form });
  assert.equal(res.status, 201);
  const order = (await res.json()).order;
  assert.match(order.image, /^https:\/\/.+\/orders\/.+\.png$/);
});

test('upload: uploaded image is actually retrievable and byte-identical via its URL', async () => {
  const jar = await newLoggedInUser('retrieve');
  const form = new FormData();
  form.append('link', 'https://example.com/p');
  form.append('image', new Blob([FIXTURE_PNG], { type: 'image/png' }), 'tiny.png');
  const createRes = await jar.fetch('/api/orders', { method: 'POST', body: form });
  const order = (await createRes.json()).order;

  const imgRes = await jar.fetch(order.image);
  assert.equal(imgRes.status, 200);
  const bytes = Buffer.from(await imgRes.arrayBuffer());
  assert.equal(bytes.length, FIXTURE_PNG.length);
});

test('upload: image URL is public but unguessable (random path component)', async () => {
  const jar = await newLoggedInUser('uploadauth');
  const form = new FormData();
  form.append('link', 'https://example.com/p');
  form.append('image', new Blob([FIXTURE_PNG], { type: 'image/png' }), 'tiny.png');
  const createRes = await jar.fetch('/api/orders', { method: 'POST', body: form });
  const order = (await createRes.json()).order;

  // Blob storage has no per-file auth (unlike the old /uploads route): anyone with the
  // exact URL can fetch it. Guard against that URL being guessable instead.
  const anonJar = createCookieJar(server.baseUrl);
  const res = await anonJar.fetch(order.image);
  assert.equal(res.status, 200);
  assert.match(order.image, /\/orders\/\d+-[0-9a-f]{12}\.png$/);
});

test('upload: rejects an oversized file (>8MB) with 400', async () => {
  const jar = await newLoggedInUser('toobig');
  const bigBuffer = Buffer.alloc(9 * 1024 * 1024, 1);
  const form = new FormData();
  form.append('link', 'https://example.com/p');
  form.append('image', new Blob([bigBuffer], { type: 'image/png' }), 'big.png');
  const res = await jar.fetch('/api/orders', { method: 'POST', body: form });
  assert.equal(res.status, 400);
});

test('upload: rejects an unsupported mimetype (text/plain) with 400', async () => {
  const jar = await newLoggedInUser('badtype');
  const form = new FormData();
  form.append('link', 'https://example.com/p');
  form.append('image', new Blob([Buffer.from('not an image')], { type: 'text/plain' }), 'note.txt');
  const res = await jar.fetch('/api/orders', { method: 'POST', body: form });
  assert.equal(res.status, 400);
});

test('upload: accepts jpeg mimetype', async () => {
  const jar = await newLoggedInUser('jpeg');
  const form = new FormData();
  form.append('link', 'https://example.com/p');
  // Content doesn't need to be a real JPEG for this test — multer's fileFilter checks the declared mimetype.
  form.append('image', new Blob([FIXTURE_PNG], { type: 'image/jpeg' }), 'photo.jpg');
  const res = await jar.fetch('/api/orders', { method: 'POST', body: form });
  assert.equal(res.status, 201);
  const order = (await res.json()).order;
  assert.match(order.image, /\.jpg$/);
});

test('upload: two uploads from the same user get distinct filenames (no overwrite)', async () => {
  const jar = await newLoggedInUser('distinct');
  const form1 = new FormData();
  form1.append('link', 'https://example.com/p1');
  form1.append('image', new Blob([FIXTURE_PNG], { type: 'image/png' }), 'a.png');
  const res1 = await jar.fetch('/api/orders', { method: 'POST', body: form1 });
  const order1 = (await res1.json()).order;

  const form2 = new FormData();
  form2.append('link', 'https://example.com/p2');
  form2.append('image', new Blob([FIXTURE_PNG], { type: 'image/png' }), 'a.png');
  const res2 = await jar.fetch('/api/orders', { method: 'POST', body: form2 });
  const order2 = (await res2.json()).order;

  assert.notEqual(order1.image, order2.image);
});
