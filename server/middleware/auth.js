import { SESSION_COOKIE, SESSION_TTL_MS, parseCookies } from '../lib/sessions.js';

export function createAuthMiddleware(stmts) {
  function attachSessionUser(req, res, next) {
    const cookies = parseCookies(req.headers.cookie);
    const sid = cookies[SESSION_COOKIE];
    req.user = null;
    req.sessionId = null;

    if (sid) {
      const session = stmts.getSession(sid);
      if (session) {
        if (session.expires_at < Date.now()) {
          stmts.deleteSession(sid);
        } else {
          const user = stmts.getUserById(session.user_id);
          if (user) {
            req.user = user;
            req.sessionId = sid;
            stmts.touchSession(sid, Date.now() + SESSION_TTL_MS);
          }
        }
      }
    }
    next();
  }

  function requireAuth(req, res, next) {
    if (!req.user) {
      return res.status(401).json({ error: { message: 'Not signed in' } });
    }
    next();
  }

  function requireAdmin(req, res, next) {
    if (!req.user) {
      return res.status(401).json({ error: { message: 'Not signed in' } });
    }
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: { message: 'Admin access required' } });
    }
    next();
  }

  return { attachSessionUser, requireAuth, requireAdmin };
}
