import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { resolveConnectionString } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

const app = createApp({
  isProduction: process.env.NODE_ENV === 'production',
  adminEmails,
  connectionString: resolveConnectionString(process.env.DATABASE_URL, process.env.POSTGRES_URL, process.env.STORAGE_POSTGRES_URL),
  staticDir: path.join(REPO_ROOT, 'public')
});

app.listen(port, () => {
  console.log(`Bneera server listening on http://localhost:${port}`);
});
