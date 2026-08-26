import { Router } from 'express';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function createLeadsRoutes({ stmts }) {
  const router = Router();

  router.post('/leads', async (req, res, next) => {
    try {
      const body = req.body || {};
      const email = typeof body.email === 'string' ? body.email.trim() : '';

      if (!email || !EMAIL_RE.test(email) || email.length > 254) {
        return res.status(400).json({ error: { message: 'A valid email is required', fields: { email: 'A valid email is required' } } });
      }

      await stmts.insertLead({ email });
      res.status(201).json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
