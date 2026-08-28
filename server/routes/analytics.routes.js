import { Router } from 'express';

const EVENT_TYPES = ['pageview', 'click'];

export function createAnalyticsRoutes({ stmts, auth }) {
  const router = Router();

  router.post('/track', async (req, res, next) => {
    try {
      const body = req.body || {};
      const eventType = typeof body.type === 'string' ? body.type : '';
      const path = typeof body.path === 'string' ? body.path.slice(0, 300) : '';
      const label = typeof body.label === 'string' ? body.label.slice(0, 200) : '';
      const visitorId = typeof body.visitorId === 'string' ? body.visitorId.slice(0, 100) : '';

      if (!EVENT_TYPES.includes(eventType) || !path || !visitorId) {
        return res.status(204).end(); // silently drop malformed beacons — never surface analytics errors to visitors
      }

      await stmts.insertAnalyticsEvent({ eventType, path, label, visitorId });
      res.status(204).end();
    } catch (err) { next(err); }
  });

  router.get('/admin/analytics', auth.requireAdmin, async (req, res, next) => {
    try {
      const summary = await stmts.getAnalyticsSummary();
      res.status(200).json({ summary });
    } catch (err) { next(err); }
  });

  return router;
}
