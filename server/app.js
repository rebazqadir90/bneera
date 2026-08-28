import express from 'express';
import path from 'node:path';
import { openDb, initSchema, createStatements } from './db.js';
import { createAuthMiddleware } from './middleware/auth.js';
import { createAuthRoutes } from './routes/auth.routes.js';
import { createLeadsRoutes } from './routes/leads.routes.js';
import { createOrdersRoutes } from './routes/orders.routes.js';
import { createAdminRoutes } from './routes/admin.routes.js';
import { createNotificationsRoutes } from './routes/notifications.routes.js';
import { createAnalyticsRoutes } from './routes/analytics.routes.js';
import { createUploadMiddleware } from './lib/upload.js';

// Shared between local dev (server.js) and the Vercel serverless entry (api/index.js).
// No static file serving here — Vercel serves public/ natively, and local dev's
// server.js adds express.static() itself. This keeps the API-only surface reusable.
export function createApp({ connectionString, adminEmails = [], isProduction = false, staticDir = null } = {}) {
  const pool = openDb(connectionString);
  const stmts = createStatements(pool);
  const auth = createAuthMiddleware(stmts);
  const upload = createUploadMiddleware();

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());
  app.use(async (req, res, next) => {
    try {
      await initSchema(pool);
      next();
    } catch (err) { next(err); }
  });
  app.use(auth.attachSessionUser);

  app.use('/api', createAuthRoutes({ stmts, auth, upload, adminEmails, isProduction }));
  app.use('/api', createLeadsRoutes({ stmts }));
  app.use('/api', createOrdersRoutes({ stmts, auth, upload }));
  app.use('/api', createAdminRoutes({ stmts, auth }));
  app.use('/api', createNotificationsRoutes({ stmts, auth }));
  app.use('/api', createAnalyticsRoutes({ stmts, auth }));

  // Local dev only: server.js passes staticDir so express.static is mounted before the
  // catch-all 404 below (registration order matters — Vercel serves public/ natively
  // instead, so api/index.js never sets this).
  if (staticDir) {
    app.use(express.static(staticDir, { index: 'index.html' }));
  }

  app.use((req, res) => {
    res.status(404).json({ error: { message: 'Not found' } });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err && err.name === 'MulterError') {
      const message = err.code === 'LIMIT_FILE_SIZE' ? 'Image is too large' :
        err.code === 'LIMIT_UNEXPECTED_FILE' ? 'Unsupported image type' : err.message;
      return res.status(400).json({ error: { message, fields: { image: message } } });
    }
    console.error(err);
    res.status(500).json({ error: { message: 'Internal server error' } });
  });

  app.locals.pool = pool;
  app.locals.stmts = stmts;
  return app;
}
