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

  router.get('/notifications', requireAuth, (req, res) => {
    const notifications = stmts.getNotificationsByUser(req.user.id).map(toPublicNotification);
    const unreadCount = stmts.getUnreadNotificationCount(req.user.id);
    res.status(200).json({ notifications, unreadCount });
  });

  router.post('/notifications/:id/read', requireAuth, (req, res) => {
    stmts.markNotificationRead(req.params.id, req.user.id);
    res.status(200).json({ ok: true });
  });

  router.post('/notifications/read-all', requireAuth, (req, res) => {
    stmts.markAllNotificationsRead(req.user.id);
    res.status(200).json({ ok: true });
  });

  return router;
}
