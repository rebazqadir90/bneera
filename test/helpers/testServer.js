import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createApp } from '../../server/server.js';

export async function startTestServer({ adminEmails = [] } = {}) {
  const tmpId = crypto.randomUUID();
  const dbPath = path.join(os.tmpdir(), `bneera-test-${tmpId}.sqlite`);
  const uploadDir = path.join(os.tmpdir(), `bneera-test-uploads-${tmpId}`);

  const app = createApp({ dbPath, uploadDir, adminEmails, isProduction: false });
  const server = http.createServer(app);

  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    baseUrl,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      app.locals.db.close();
      for (const p of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
        fs.rmSync(p, { force: true });
      }
      fs.rmSync(uploadDir, { recursive: true, force: true });
    }
  };
}
