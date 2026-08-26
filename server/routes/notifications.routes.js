import { Router } from 'express';

function toPublicNotification(n) {
  return {
    id: n.id,
    orderId: n.order_id,
    message: n.message,
    read: !!n.is_read,
    createdAt: n.created_at
  };
}

export function createNotificationsRoutes({ stmts, auth }) {
  const router = Router();
  const { requireAuth } = auth;

  router.get('/notifications', requireAuth, async (req, res, next) => {
    try {
      const notifications = (await stmts.getNotificationsByUser(req.user.id)).map(toPublicNotification);
      const unreadCount = await stmts.getUnreadNotificationCount(req.user.id);
      res.status(200).json({ notifications, unreadCount });
    } catch (err) { next(err); }
  });

  router.post('/notifications/:id/read', requireAuth, async (req, res, next) => {
    try {
      await stmts.markNotificationRead(req.params.id, req.user.id);
      res.status(200).json({ ok: true });
    } catch (err) { next(err); }
  });

  router.post('/notifications/read-all', requireAuth, async (req, res, next) => {
    try {
      await stmts.markAllNotificationsRead(req.user.id);
      res.status(200).json({ ok: true });
    } catch (err) { next(err); }
  });

  return router;
}
