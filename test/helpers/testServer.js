import http from 'node:http';
import { createApp } from '../../server/app.js';

export async function startTestServer({ adminEmails = [] } = {}) {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) {
    throw new Error('TEST_DATABASE_URL is not set. Point it at a Postgres database to run the test suite.');
  }

  const app = createApp({ connectionString, adminEmails, isProduction: false });
  const server = http.createServer(app);

  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    baseUrl,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await app.locals.pool.end();
    }
  };
}
