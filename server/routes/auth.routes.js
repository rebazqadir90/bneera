import { Router } from 'express';
import { hashPassword, verifyPassword } from '../lib/passwords.js';
import { SESSION_COOKIE, SESSION_TTL_MS, generateSessionId, serializeCookie, clearCookie } from '../lib/sessions.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function toPublicUser(user) {
  return { id: user.id, email: user.email, fullName: user.full_name, role: user.role };
}

function toPublicShippingProfile(profile) {
  if (!profile) return null;
  return {
    firstName: profile.first_name,
    lastName: profile.last_name,
    address: profile.address,
    city: profile.city,
    phone: profile.phone,
    phone2: profile.phone2
  };
}

export function createAuthRoutes({ stmts, auth, adminEmails, isProduction }) {
  const router = Router();

  function setSessionCookie(res, userId) {
    const sid = generateSessionId();
    const expiresAt = Date.now() + SESSION_TTL_MS;
    stmts.insertSession({ id: sid, userId, expiresAt });
    res.setHeader('Set-Cookie', serializeCookie(SESSION_COOKIE, sid, {
      maxAgeMs: SESSION_TTL_MS,
      secure: isProduction
    }));
  }

  router.post('/signup', async (req, res, next) => {
    try {
      const body = req.body || {};
      const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '';
      const email = typeof body.email === 'string' ? body.email.trim() : '';
      const password = typeof body.password === 'string' ? body.password : '';
      const confirmPassword = typeof body.confirmPassword === 'string' ? body.confirmPassword : '';
      const agree = body.agree === true;

      const fields = {};
      if (!fullName || fullName.length > 200) fields.fullName = 'Full name is required';
      if (!email || !EMAIL_RE.test(email) || email.length > 254) fields.email = 'A valid email is required';
      if (!password || password.length < 8 || password.length > 256) fields.password = 'Password must be at least 8 characters';
      if (confirmPassword !== password) fields.confirmPassword = "Passwords don't match";
      if (!agree) fields.agree = 'You must agree to the terms';

      if (Object.keys(fields).length > 0) {
        return res.status(400).json({ error: { message: 'Invalid signup details', fields } });
      }

      if (stmts.getUserByEmail(email)) {
        return res.status(409).json({ error: { message: 'Email already registered', fields: { email: 'Email already registered' } } });
      }

      const passwordHash = await hashPassword(password);
      const role = adminEmails.includes(email.toLowerCase()) ? 'admin' : 'user';
      const user = stmts.insertUser({ email, fullName, passwordHash, role });

      setSessionCookie(res, user.id);
      res.status(201).json({ user: toPublicUser(user) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/login', async (req, res, next) => {
    try {
      const body = req.body || {};
      const email = typeof body.email === 'string' ? body.email.trim() : '';
      const password = typeof body.password === 'string' ? body.password : '';

      const genericError = () => res.status(401).json({ error: { message: 'Incorrect email or password' } });

      if (!email || !password) return genericError();

      const user = stmts.getUserByEmail(email);
      if (!user) return genericError();

      const ok = await verifyPassword(password, user.password_hash);
      if (!ok) return genericError();

      setSessionCookie(res, user.id);
      res.status(200).json({ user: toPublicUser(user) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/logout', (req, res) => {
    if (req.sessionId) {
      stmts.deleteSession(req.sessionId);
    }
    res.setHeader('Set-Cookie', clearCookie(SESSION_COOKIE, { secure: isProduction }));
    res.status(204).end();
  });

  router.get('/me', (req, res) => {
    res.status(200).json({ user: req.user ? toPublicUser(req.user) : null });
  });

  router.get('/me/shipping', auth.requireAuth, (req, res) => {
    const profile = stmts.getShippingProfile(req.user.id);
    res.status(200).json({ shipping: toPublicShippingProfile(profile) });
  });

  return router;
}

export { toPublicUser };
