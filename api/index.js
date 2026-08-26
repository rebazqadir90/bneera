import { createApp } from '../server/app.js';
import { resolveConnectionString } from '../server/db.js';

const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

const app = createApp({
  isProduction: process.env.NODE_ENV === 'production',
  adminEmails,
  connectionString: resolveConnectionString(process.env.DATABASE_URL, process.env.POSTGRES_URL, process.env.STORAGE_POSTGRES_URL)
});

export default app;
