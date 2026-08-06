import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, createStatements } from './db.js';
import { createAuthMiddleware } from './middleware/auth.js';
import { createAuthRoutes } from './routes/auth.routes.js';
import { createLeadsRoutes } from './routes/leads.routes.js';
import { createOrdersRoutes } from './routes/orders.routes.js';
import { createAdminRoutes } from './routes/admin.routes.js';
import { createUploadMiddleware } from './lib/upload.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

export function createApp({ dbPath, uploadDir, publicDir, adminEmails = [], isProduction = false } = {}) {
  const resolvedPublicDir = publicDir || path.join(REPO_ROOT, 'public');
  const resolvedUploadDir = uploadDir || path.join(resolvedPublicDir, 'uploads');

  const db = openDb(dbPath || path.join(REPO_ROOT, 'data.sqlite'));
  const stmts = createStatements(db);
  const auth = createAuthMiddleware(stmts);
  const upload = createUploadMiddleware(resolvedUploadDir);

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());
  app.use(auth.attachSessionUser);

  app.use('/api', createAuthRoutes({ stmts, auth, adminEmails, isProduction }));
  app.use('/api', createLeadsRoutes({ stmts }));
  app.use('/api', createOrdersRoutes({ stmts, auth, upload }));
  app.use('/api', createAdminRoutes({ stmts, auth }));

  app.use('/uploads', auth.requireAuth, express.static(resolvedUploadDir));
  app.use(express.static(resolvedPublicDir, { index: 'index.html' }));

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

  app.locals.db = db;
  app.locals.stmts = stmts;
  return app;
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const app = createApp({
    isProduction: process.env.NODE_ENV === 'production',
    adminEmails
  });
  app.listen(port, () => {
    console.log(`Bneera server listening on http://localhost:${port}`);
  });
}
