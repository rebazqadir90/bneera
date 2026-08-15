import { Router } from 'express';
import { hashPassword, verifyPassword } from '../lib/passwords.js';
import {
  SESSION_COOKIE, SESSION_TTL_MS, RESET_TOKEN_TTL_MS,
  generateSessionId, generateResetToken, serializeCookie, clearCookie
} from '../lib/sessions.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function toPublicUser(user) {
  return { id: user.id, email: user.email, fullName: user.full_name, role: user.role, avatar: user.avatar || '', createdAt: user.created_at };
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

export function createAuthRoutes({ stmts, auth, upload, adminEmails, isProduction }) {
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

  router.post('/forgot-password', async (req, res, next) => {
    try {
      const body = req.body || {};
      const email = typeof body.email === 'string' ? body.email.trim() : '';

      // Always the same response whether or not the email exists — avoids leaking which
      // addresses are registered.
      const genericResponse = { ok: true, message: "If that email is registered, we've sent a reset link." };

      if (!email || !EMAIL_RE.test(email)) {
        return res.status(200).json(genericResponse);
      }

      const user = stmts.getUserByEmail(email);
      if (!user) {
        return res.status(200).json(genericResponse);
      }

      stmts.deleteResetTokensByUser(user.id); // invalidate any earlier outstanding token
      const token = generateResetToken();
      stmts.insertResetToken({ token, userId: user.id, expiresAt: Date.now() + RESET_TOKEN_TTL_MS });

      const resetUrl = `${req.protocol}://${req.get('host')}/reset-password.html?token=${token}`;
      // No email provider is configured yet, so the link is logged server-side for now.
      // Wire in a real email service (Resend/SendGrid/SMTP) here before going live for real customers.
      console.log(`[password reset] ${email} -> ${resetUrl}`);

      const responseBody = { ...genericResponse };
      if (!isProduction) {
        responseBody.devResetUrl = resetUrl; // convenience for local/dev testing only
      }
      res.status(200).json(responseBody);
    } catch (err) {
      next(err);
    }
  });

  router.post('/reset-password', async (req, res, next) => {
    try {
      const body = req.body || {};
      const token = typeof body.token === 'string' ? body.token : '';
      const password = typeof body.password === 'string' ? body.password : '';
      const confirmPassword = typeof body.confirmPassword === 'string' ? body.confirmPassword : '';

      const fields = {};
      if (!password || password.length < 8 || password.length > 256) fields.password = 'Password must be at least 8 characters';
      if (confirmPassword !== password) fields.confirmPassword = "Passwords don't match";
      if (Object.keys(fields).length > 0) {
        return res.status(400).json({ error: { message: 'Invalid password details', fields } });
      }

      const record = token ? stmts.getResetToken(token) : null;
      if (!record) {
        return res.status(400).json({ error: { message: 'This reset link is invalid. Request a new one.' } });
      }
      if (record.expires_at < Date.now()) {
        stmts.deleteResetToken(token);
        return res.status(400).json({ error: { message: 'This reset link has expired. Request a new one.' } });
      }

      const passwordHash = await hashPassword(password);
      stmts.updateUserPassword(record.user_id, passwordHash);
      stmts.deleteResetToken(token);
      stmts.deleteSessionsByUser(record.user_id); // sign the account out everywhere for security

      res.status(200).json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.get('/me', (req, res) => {
    res.status(200).json({ user: req.user ? toPublicUser(req.user) : null });
  });

  router.get('/me/shipping', auth.requireAuth, (req, res) => {
    const profile = stmts.getShippingProfile(req.user.id);
    res.status(200).json({ shipping: toPublicShippingProfile(profile) });
  });

  router.patch('/me/shipping', auth.requireAuth, (req, res) => {
    const body = req.body || {};
    function trimmed(key) { return typeof body[key] === 'string' ? body[key].trim() : ''; }
    const shipping = {
      firstName: trimmed('firstName'),
      lastName: trimmed('lastName'),
      address: trimmed('address'),
      city: trimmed('city'),
      phone: trimmed('phone'),
      phone2: trimmed('phone2')
    };

    const fields = {};
    if (!shipping.firstName || shipping.firstName.length > 100) fields.firstName = 'First name is required';
    if (!shipping.lastName || shipping.lastName.length > 100) fields.lastName = 'Last name is required';
    if (!shipping.address || shipping.address.length > 500) fields.address = 'Full address is required';
    if (!shipping.city || shipping.city.length > 100) fields.city = 'City is required';
    if (!shipping.phone || shipping.phone.length > 40) fields.phone = 'Phone number is required';
    if (shipping.phone2 && shipping.phone2.length > 40) fields.phone2 = 'Second phone number is too long';

    if (Object.keys(fields).length > 0) {
      return res.status(400).json({ error: { message: 'Invalid shipping details', fields } });
    }

    const profile = stmts.upsertShippingProfile(req.user.id, shipping);
    res.status(200).json({ shipping: toPublicShippingProfile(profile) });
  });

  router.post('/me/change-password', auth.requireAuth, async (req, res, next) => {
    try {
      const body = req.body || {};
      const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
      const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
      const confirmNewPassword = typeof body.confirmNewPassword === 'string' ? body.confirmNewPassword : '';

      const fields = {};
      if (!currentPassword) fields.currentPassword = 'Current password is required';
      if (!newPassword || newPassword.length < 8 || newPassword.length > 256) fields.newPassword = 'New password must be at least 8 characters';
      if (confirmNewPassword !== newPassword) fields.confirmNewPassword = "Passwords don't match";
      if (Object.keys(fields).length > 0) {
        return res.status(400).json({ error: { message: 'Invalid password details', fields } });
      }

      const ok = await verifyPassword(currentPassword, req.user.password_hash);
      if (!ok) {
        return res.status(400).json({ error: { message: 'Current password is incorrect', fields: { currentPassword: 'Current password is incorrect' } } });
      }

      const passwordHash = await hashPassword(newPassword);
      stmts.updateUserPassword(req.user.id, passwordHash);
      stmts.deleteOtherSessions(req.user.id, req.sessionId); // sign out everywhere else, keep this session active

      res.status(200).json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.post('/me/avatar', auth.requireAuth, (req, res, next) => {
    upload.single('avatar')(req, res, (err) => {
      if (err) return next(err);
      if (!req.file) {
        return res.status(400).json({ error: { message: 'An image file is required', fields: { avatar: 'An image file is required' } } });
      }
      const avatarPath = `/uploads/${req.file.filename}`;
      const user = stmts.updateUserAvatar(req.user.id, avatarPath);
      res.status(200).json({ user: toPublicUser(user) });
    });
  });

  return router;
}

export { toPublicUser };
