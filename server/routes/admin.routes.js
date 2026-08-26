import { Router } from 'express';
import { toPublicOrder } from './orders.routes.js';

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

  return router;
}
