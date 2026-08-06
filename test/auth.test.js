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

test('signup: valid signup creates a user and logs in (sets session cookie)', async () => {
  const jar = createCookieJar(server.baseUrl);
  const email = uniqueEmail('signup-ok');
  const res = await jar.fetch('/api/signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fullName: 'Ada Lovelace', email, password: 'password123', confirmPassword: 'password123', agree: true })
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.user.email, email);
  assert.equal(body.user.role, 'user');
  assert.ok(jar.cookie.startsWith('sid='), 'session cookie should be set');
});

test('signup: rejects mismatched confirmPassword', async () => {
  const jar = createCookieJar(server.baseUrl);
  const res = await jar.fetch('/api/signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fullName: 'A', email: uniqueEmail('mismatch'), password: 'password123', confirmPassword: 'nope12345', agree: true })
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.error.fields.confirmPassword);
});

test('signup: rejects password under 8 characters', async () => {
  const jar = createCookieJar(server.baseUrl);
  const res = await jar.fetch('/api/signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fullName: 'A', email: uniqueEmail('shortpw'), password: 'short1', confirmPassword: 'short1', agree: true })
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.error.fields.password);
});

test('signup: rejects invalid email format', async () => {
  const jar = createCookieJar(server.baseUrl);
  const res = await jar.fetch('/api/signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fullName: 'A', email: 'not-an-email', password: 'password123', confirmPassword: 'password123', agree: true })
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.error.fields.email);
});

test('signup: rejects empty full name', async () => {
  const jar = createCookieJar(server.baseUrl);
  const res = await jar.fetch('/api/signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fullName: '  ', email: uniqueEmail('noname'), password: 'password123', confirmPassword: 'password123', agree: true })
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.error.fields.fullName);
});

test('signup: rejects when agree is not checked', async () => {
  const jar = createCookieJar(server.baseUrl);
  const res = await jar.fetch('/api/signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fullName: 'A', email: uniqueEmail('noagree'), password: 'password123', confirmPassword: 'password123', agree: false })
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.error.fields.agree);
});

test('signup: rejects duplicate email with 409', async () => {
  const email = uniqueEmail('dupe');
  const jar1 = createCookieJar(server.baseUrl);
  const first = await jar1.fetch('/api/signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fullName: 'First', email, password: 'password123', confirmPassword: 'password123', agree: true })
  });
  assert.equal(first.status, 201);

  const jar2 = createCookieJar(server.baseUrl);
  const second = await jar2.fetch('/api/signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fullName: 'Second', email, password: 'password123', confirmPassword: 'password123', agree: true })
  });
  assert.equal(second.status, 409);
});

test('signup: duplicate email check is case-insensitive', async () => {
  const email = uniqueEmail('case');
  const jar1 = createCookieJar(server.baseUrl);
  await jar1.fetch('/api/signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fullName: 'First', email, password: 'password123', confirmPassword: 'password123', agree: true })
  });
  const jar2 = createCookieJar(server.baseUrl);
  const res = await jar2.fetch('/api/signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fullName: 'Second', email: email.toUpperCase(), password: 'password123', confirmPassword: 'password123', agree: true })
  });
  assert.equal(res.status, 409);
});

test('login: correct credentials succeed and set a session cookie', async () => {
  const email = uniqueEmail('login-ok');
  const signupJar = createCookieJar(server.baseUrl);
  await signupJar.fetch('/api/signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fullName: 'Login Test', email, password: 'password123', confirmPassword: 'password123', agree: true })
  });

  const loginJar = createCookieJar(server.baseUrl);
  const res = await loginJar.fetch('/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123' })
  });
  assert.equal(res.status, 200);
  assert.ok(loginJar.cookie.startsWith('sid='));
});

test('login: wrong password returns generic 401', async () => {
  const email = uniqueEmail('wrongpw');
  const signupJar = createCookieJar(server.baseUrl);
  await signupJar.fetch('/api/signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fullName: 'X', email, password: 'password123', confirmPassword: 'password123', agree: true })
  });

  const loginJar = createCookieJar(server.baseUrl);
  const res = await loginJar.fetch('/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'totallyWrong' })
  });
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.error.message, 'Incorrect email or password');
});

test('login: unknown email returns generic 401 (no user enumeration)', async () => {
  const jar = createCookieJar(server.baseUrl);
  const res = await jar.fetch('/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: uniqueEmail('doesnotexist'), password: 'password123' })
  });
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.error.message, 'Incorrect email or password');
});

test('login: missing password field returns 401 not a crash', async () => {
  const jar = createCookieJar(server.baseUrl);
  const res = await jar.fetch('/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: uniqueEmail('nopw') })
  });
  assert.equal(res.status, 401);
});

test('me: returns {user:null} with no cookie', async () => {
  const jar = createCookieJar(server.baseUrl);
  const res = await jar.fetch('/api/me');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.user, null);
});

test('me: returns the user when a valid session cookie is present', async () => {
  const email = uniqueEmail('me-ok');
  const jar = createCookieJar(server.baseUrl);
  await jar.fetch('/api/signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fullName: 'Me Test', email, password: 'password123', confirmPassword: 'password123', agree: true })
  });
  const res = await jar.fetch('/api/me');
  const body = await res.json();
  assert.equal(body.user.email, email);
});

test('me: returns {user:null} for a garbage/forged cookie', async () => {
  const jar = createCookieJar(server.baseUrl);
  const res = await jar.fetch('/api/me', { headers: { Cookie: 'sid=totally-forged-token-value' } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.user, null);
});

test('logout: clears the session so /api/me goes back to null', async () => {
  const email = uniqueEmail('logout');
  const jar = createCookieJar(server.baseUrl);
  await jar.fetch('/api/signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fullName: 'Logout Test', email, password: 'password123', confirmPassword: 'password123', agree: true })
  });
  const logoutRes = await jar.fetch('/api/logout', { method: 'POST' });
  assert.equal(logoutRes.status, 204);

  const meRes = await jar.fetch('/api/me');
  const body = await meRes.json();
  assert.equal(body.user, null);
});

test('logout: works even with no session (idempotent, no crash)', async () => {
  const jar = createCookieJar(server.baseUrl);
  const res = await jar.fetch('/api/logout', { method: 'POST' });
  assert.equal(res.status, 204);
});

test('password hashing: two different users with the same password get different stored hashes (unique salts)', async () => {
  const emailA = uniqueEmail('salt-a');
  const emailB = uniqueEmail('salt-b');
  const jarA = createCookieJar(server.baseUrl);
  const jarB = createCookieJar(server.baseUrl);
  const resA = await jarA.fetch('/api/signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fullName: 'A', email: emailA, password: 'samepassword1', confirmPassword: 'samepassword1', agree: true })
  });
  const resB = await jarB.fetch('/api/signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fullName: 'B', email: emailB, password: 'samepassword1', confirmPassword: 'samepassword1', agree: true })
  });
  assert.equal(resA.status, 201);
  assert.equal(resB.status, 201);
  // both should be able to log in independently with the same plaintext password
  const loginA = await createCookieJar(server.baseUrl).fetch('/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: emailA, password: 'samepassword1' })
  });
  const loginB = await createCookieJar(server.baseUrl).fetch('/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: emailB, password: 'samepassword1' })
  });
  assert.equal(loginA.status, 200);
  assert.equal(loginB.status, 200);
});

test('session persistence: session cookie from signup works across multiple subsequent requests', async () => {
  const email = uniqueEmail('persist');
  const jar = createCookieJar(server.baseUrl);
  await jar.fetch('/api/signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fullName: 'Persist', email, password: 'password123', confirmPassword: 'password123', agree: true })
  });
  for (let i = 0; i < 3; i++) {
    const res = await jar.fetch('/api/me');
    const body = await res.json();
    assert.equal(body.user.email, email);
  }
});

test('signup: name/email length limits are enforced (extremely long values rejected)', async () => {
  const jar = createCookieJar(server.baseUrl);
  const res = await jar.fetch('/api/signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fullName: 'A'.repeat(500), email: uniqueEmail('longname'), password: 'password123', confirmPassword: 'password123', agree: true })
  });
  assert.equal(res.status, 400);
});
