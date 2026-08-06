export function createCookieJar(baseUrl) {
  let cookie = '';

  async function jarFetch(pathOrUrl, options = {}) {
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : baseUrl + pathOrUrl;
    const headers = new Headers(options.headers || {});
    if (cookie) headers.set('Cookie', cookie);

    const res = await fetch(url, { ...options, headers, redirect: 'manual' });

    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      const pair = setCookie.split(';')[0];
      if (pair.endsWith('=')) {
        cookie = '';
      } else {
        cookie = pair;
      }
    }
    return res;
  }

  return { fetch: jarFetch, get cookie() { return cookie; } };
}

export async function signupAndLogin(jar, { fullName = 'Test User', email, password = 'password123' }) {
  const res = await jar.fetch('/api/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fullName, email, password, confirmPassword: password, agree: true })
  });
  return res;
}
