import { Router } from 'express';
import { toPublicOrder } from './orders.routes.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function toPublicAdminUser(user) {
  return { id: user.id, email: user.email, fullName: user.full_name, role: user.role, createdAt: user.created_at };
}

export function createAdminRoutes({ stmts, auth }) {
  const router = Router();
  const { requireAdmin } = auth;

  router.get('/admin/users', requireAdmin, async (req, res, next) => {
    try {
      const users = (await stmts.getAllUsers()).map(toPublicAdminUser);
      res.status(200).json({ users, count: users.length });
    } catch (err) { next(err); }
  });

  router.get('/admin/orders', requireAdmin, async (req, res, next) => {
    try {
      const orders = (await stmts.getAllOrdersWithOwner()).map((o) => ({
        ...toPublicOrder(o),
        ownerEmail: o.owner_email,
        ownerFullName: o.owner_full_name
      }));
      res.status(200).json({ orders, count: orders.length });
    } catch (err) { next(err); }
  });

  router.get('/admin/stats', requireAdmin, async (req, res, next) => {
    try {
      const stats = await stmts.getAdminStats();
      res.status(200).json({ stats });
    } catch (err) { next(err); }
  });

  router.get('/admin/marketplaces', requireAdmin, async (req, res, next) => {
    try {
      const marketplaces = await stmts.getMarketplaceBreakdown();
      res.status(200).json({ marketplaces });
    } catch (err) { next(err); }
  });

  router.patch('/admin/users/:id/role', requireAdmin, async (req, res, next) => {
    try {
      const targetId = Number(req.params.id);
      const role = req.body && req.body.role;
      if (role !== 'user' && role !== 'admin') {
        return res.status(400).json({ error: { message: 'Role must be "user" or "admin"' } });
      }
      if (targetId === req.user.id) {
        return res.status(400).json({ error: { message: 'You cannot change your own role' } });
      }
      const updated = await stmts.updateUserRole(targetId, role);
      if (!updated) {
        return res.status(404).json({ error: { message: 'User not found' } });
      }
      res.status(200).json({ user: toPublicAdminUser(updated) });
    } catch (err) { next(err); }
  });

  router.patch('/admin/users/:id', requireAdmin, async (req, res, next) => {
    try {
      const targetId = Number(req.params.id);
      const body = req.body || {};
      const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '';
      const email = typeof body.email === 'string' ? body.email.trim() : '';

      const fields = {};
      if (!fullName || fullName.length > 200) fields.fullName = 'Full name is required';
      if (!email || !EMAIL_RE.test(email) || email.length > 254) fields.email = 'A valid email is required';
      if (Object.keys(fields).length > 0) {
        return res.status(400).json({ error: { message: 'Invalid account details', fields } });
      }

      const updated = await stmts.updateUserProfile(targetId, { fullName, email });
      if (!updated) {
        return res.status(404).json({ error: { message: 'User not found' } });
      }
      res.status(200).json({ user: toPublicAdminUser(updated) });
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: { message: 'Email already registered', fields: { email: 'Email already registered' } } });
      }
      next(err);
    }
  });

  return router;
}
