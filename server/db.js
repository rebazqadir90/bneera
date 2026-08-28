import pg from 'pg';

const { Pool, types } = pg;

// BIGINT (OID 20) is returned as a string by default to avoid precision loss on huge values.
// Every BIGINT column here stores Date.now() (~1.8 trillion), safely within Number.MAX_SAFE_INTEGER,
// so parse it as a real JS number globally instead of scattering Number() calls at every call site.
types.setTypeParser(20, (val) => parseInt(val, 10));

export const STATUSES = [
  'Pending', 'Processed', 'Confirmed', 'Purchased', 'Received',
  'Shipped To Iraq', 'Arrived', 'Delivered', 'Canceled'
];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email         TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  avatar        TEXT NOT NULL DEFAULT '',
  created_at    BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users (LOWER(email));

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS orders (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status     TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN (
               'Pending','Processed','Confirmed','Purchased','Received',
               'Shipped To Iraq','Arrived','Delivered','Canceled')),
  created_at BIGINT NOT NULL,
  link       TEXT NOT NULL,
  quantity   INTEGER NOT NULL CHECK (quantity > 0),
  size       TEXT NOT NULL DEFAULT '',
  color      TEXT NOT NULL DEFAULT '',
  note       TEXT NOT NULL DEFAULT '',
  image      TEXT NOT NULL DEFAULT '',
  price      DOUBLE PRECISION NOT NULL DEFAULT 0,
  tax        DOUBLE PRECISION NOT NULL DEFAULT 0,
  tax_rate   DOUBLE PRECISION NOT NULL DEFAULT 0,
  shipping   DOUBLE PRECISION NOT NULL DEFAULT 0,
  weight     DOUBLE PRECISION NOT NULL DEFAULT 0,
  ship_first_name TEXT NOT NULL DEFAULT '',
  ship_last_name  TEXT NOT NULL DEFAULT '',
  ship_address    TEXT NOT NULL DEFAULT '',
  ship_city       TEXT NOT NULL DEFAULT '',
  ship_phone      TEXT NOT NULL DEFAULT '',
  ship_phone2     TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);

CREATE TABLE IF NOT EXISTS leads (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email      TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS shipping_profiles (
  user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL,
  last_name  TEXT NOT NULL,
  address    TEXT NOT NULL,
  city       TEXT NOT NULL,
  phone      TEXT NOT NULL,
  phone2     TEXT NOT NULL DEFAULT '',
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reset_tokens_user_id ON password_reset_tokens(user_id);

CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id   TEXT REFERENCES orders(id) ON DELETE CASCADE,
  message    TEXT NOT NULL,
  is_read    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
`;

let schemaInitialized = false;

// Picks the first candidate that actually looks like a Postgres connection string, skipping
// unset/empty values and any placeholder text that isn't a real "postgres://" URL.
export function resolveConnectionString(...candidates) {
  return candidates.find((c) => typeof c === 'string' && /^postgres(ql)?:\/\//.test(c));
}

export function openDb(connectionString) {
  // Supabase's pooler presents a cert chain that isn't in Node's default CA bundle. The
  // connection string's own sslmode=require overrides an explicit ssl option if left in
  // place, so strip it and rely on the ssl config below instead (still TLS-encrypted,
  // just not chain-verified against a public CA).
  const url = new URL(connectionString);
  url.searchParams.delete('sslmode');
  // Keep the per-process pool small: Supabase's free-tier pooler has a limited number of
  // client slots, and each serverless invocation (or, locally, each test file process)
  // opens its own pool.
  const pool = new Pool({ connectionString: url.toString(), ssl: { rejectUnauthorized: false }, max: 5 });
  return pool;
}

// Arbitrary fixed key for a Postgres advisory lock (server-wide, not just per-process).
// Node's test runner starts each test file as a separate process, so concurrent cold
// starts can race on "CREATE TABLE IF NOT EXISTS" and collide on Postgres's internal
// pg_type catalog; the lock serializes schema creation across all of them.
//
// Supabase's connection string points at its transaction-mode pooler, which can hand
// separate statements on the same client to different backend connections. A session-scoped
// pg_advisory_lock/unlock pair as two separate statements can therefore acquire on one
// backend and try to release on another, leaking the lock and hanging every other process
// behind it until Supabase's statement_timeout kills them. A transaction-scoped
// pg_advisory_xact_lock inside one explicit BEGIN/COMMIT stays pinned to a single backend
// for the whole transaction and auto-releases on COMMIT/ROLLBACK, so it's pooler-safe.
const SCHEMA_LOCK_KEY = 727116;

export async function initSchema(pool) {
  if (schemaInitialized) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [SCHEMA_LOCK_KEY]);
    await client.query(SCHEMA);
    await client.query('COMMIT');
    schemaInitialized = true;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Matches the frontend's own generateId() convention: Date.now().toString(36) + 3 random base36 chars, upper-cased.
function makeOrderId() {
  const rand = Math.random().toString(36).slice(2, 5);
  return (Date.now().toString(36) + rand).toUpperCase();
}

export function createStatements(pool) {
  return {
    async insertUser({ email, fullName, passwordHash, role = 'user' }) {
      const { rows } = await pool.query(
        `INSERT INTO users (email, full_name, password_hash, role, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [email, fullName, passwordHash, role, Date.now()]
      );
      return rows[0];
    },
    async getUserByEmail(email) {
      const { rows } = await pool.query(`SELECT * FROM users WHERE LOWER(email) = LOWER($1)`, [email]);
      return rows[0] || null;
    },
    async getUserById(id) {
      const { rows } = await pool.query(`SELECT * FROM users WHERE id = $1`, [id]);
      return rows[0] || null;
    },

    async insertSession({ id, userId, expiresAt }) {
      await pool.query(
        `INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)`,
        [id, userId, Date.now(), expiresAt]
      );
    },
    async getSession(id) {
      const { rows } = await pool.query(`SELECT * FROM sessions WHERE id = $1`, [id]);
      return rows[0] || null;
    },
    async touchSession(id, expiresAt) {
      await pool.query(`UPDATE sessions SET expires_at = $1 WHERE id = $2`, [expiresAt, id]);
    },
    async deleteSession(id) {
      await pool.query(`DELETE FROM sessions WHERE id = $1`, [id]);
    },
    async deleteExpiredSessions() {
      await pool.query(`DELETE FROM sessions WHERE expires_at < $1`, [Date.now()]);
    },

    async insertOrder({ userId, status = 'Pending', link, quantity, size = '', color = '', note = '', image = '' }) {
      const now = Date.now();
      for (let attempt = 0; attempt < 5; attempt++) {
        const id = makeOrderId();
        try {
          const { rows } = await pool.query(
            `INSERT INTO orders (id, user_id, status, created_at, link, quantity, size, color, note, image, price, tax, tax_rate, shipping, weight)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 0, 0, 0, 0, 0) RETURNING *`,
            [id, userId, status, now, link, quantity, size, color, note, image]
          );
          return rows[0];
        } catch (err) {
          if (err.code === '23505' && attempt < 4) continue;
          throw err;
        }
      }
      throw new Error('Failed to generate a unique order id');
    },
    async getOrdersByUser(userId) {
      const { rows } = await pool.query(`SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC`, [userId]);
      return rows;
    },
    async getOrderById(id) {
      const { rows } = await pool.query(`SELECT * FROM orders WHERE id = $1`, [id]);
      return rows[0] || null;
    },
    async updateOrderStatus(id, status) {
      const { rows } = await pool.query(`UPDATE orders SET status = $1 WHERE id = $2 RETURNING *`, [status, id]);
      return rows[0];
    },
    // weight/price/shipping are absolute values; taxRate is a PERCENTAGE (e.g. 5 = 5%).
    // tax is always re-derived here as price * quantity * taxRate / 100, so it self-corrects
    // whenever price or taxRate changes later, instead of drifting out of sync.
    async updateOrderDetails(id, { weight, price, taxRate, shipping }) {
      const existing = await this.getOrderById(id);
      const tax = price * existing.quantity * (taxRate / 100);
      const { rows } = await pool.query(
        `UPDATE orders SET weight = $1, price = $2, tax = $3, tax_rate = $4, shipping = $5 WHERE id = $6 RETURNING *`,
        [weight, price, tax, taxRate, shipping, id]
      );
      return rows[0];
    },
    // Atomic: upserts the shipping profile and confirms the order together, so a crash
    // mid-flow can never leave the profile updated but the order still unconfirmed.
    async confirmOrderWithShipping(id, userId, { firstName, lastName, address, city, phone, phone2 }) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `INSERT INTO shipping_profiles (user_id, first_name, last_name, address, city, phone, phone2, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (user_id) DO UPDATE SET
             first_name = excluded.first_name, last_name = excluded.last_name, address = excluded.address,
             city = excluded.city, phone = excluded.phone, phone2 = excluded.phone2, updated_at = excluded.updated_at`,
          [userId, firstName, lastName, address, city, phone, phone2, Date.now()]
        );
        const { rows } = await client.query(
          `UPDATE orders SET status = 'Confirmed',
             ship_first_name = $1, ship_last_name = $2, ship_address = $3, ship_city = $4, ship_phone = $5, ship_phone2 = $6
           WHERE id = $7 RETURNING *`,
          [firstName, lastName, address, city, phone, phone2, id]
        );
        await client.query('COMMIT');
        return rows[0];
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
    async getShippingProfile(userId) {
      const { rows } = await pool.query(`SELECT * FROM shipping_profiles WHERE user_id = $1`, [userId]);
      return rows[0] || null;
    },
    async upsertShippingProfile(userId, { firstName, lastName, address, city, phone, phone2 }) {
      const { rows } = await pool.query(
        `INSERT INTO shipping_profiles (user_id, first_name, last_name, address, city, phone, phone2, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (user_id) DO UPDATE SET
           first_name = excluded.first_name, last_name = excluded.last_name, address = excluded.address,
           city = excluded.city, phone = excluded.phone, phone2 = excluded.phone2, updated_at = excluded.updated_at
         RETURNING *`,
        [userId, firstName, lastName, address, city, phone, phone2, Date.now()]
      );
      return rows[0];
    },

    async insertLead({ email }) {
      await pool.query(`INSERT INTO leads (email, created_at) VALUES ($1, $2)`, [email, Date.now()]);
    },

    async updateUserPassword(userId, passwordHash) {
      await pool.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [passwordHash, userId]);
    },
    async updateUserAvatar(userId, avatarPath) {
      const { rows } = await pool.query(`UPDATE users SET avatar = $1 WHERE id = $2 RETURNING *`, [avatarPath, userId]);
      return rows[0];
    },
    async deleteSessionsByUser(userId) {
      await pool.query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
    },
    async deleteOtherSessions(userId, keepSessionId) {
      await pool.query(`DELETE FROM sessions WHERE user_id = $1 AND id != $2`, [userId, keepSessionId]);
    },

    // Fires status-change + notification together so they can never desync under a network DB.
    async updateOrderStatusWithNotification(id, status, message) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(`UPDATE orders SET status = $1 WHERE id = $2 RETURNING *`, [status, id]);
        const order = rows[0];
        await client.query(
          `INSERT INTO notifications (user_id, order_id, message, is_read, created_at) VALUES ($1, $2, $3, FALSE, $4)`,
          [order.user_id, order.id, message, Date.now()]
        );
        await client.query('COMMIT');
        return order;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },

    async insertNotification({ userId, orderId = null, message }) {
      await pool.query(
        `INSERT INTO notifications (user_id, order_id, message, is_read, created_at) VALUES ($1, $2, $3, FALSE, $4)`,
        [userId, orderId, message, Date.now()]
      );
    },
    async getNotificationsByUser(userId) {
      const { rows } = await pool.query(
        `SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
        [userId]
      );
      return rows;
    },
    async getUnreadNotificationCount(userId) {
      const { rows } = await pool.query(
        `SELECT COUNT(*)::int AS c FROM notifications WHERE user_id = $1 AND is_read = FALSE`,
        [userId]
      );
      return rows[0].c;
    },
    async markNotificationRead(id, userId) {
      await pool.query(`UPDATE notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2`, [id, userId]);
    },
    async markAllNotificationsRead(userId) {
      await pool.query(`UPDATE notifications SET is_read = TRUE WHERE user_id = $1`, [userId]);
    },

    async insertResetToken({ token, userId, expiresAt }) {
      await pool.query(
        `INSERT INTO password_reset_tokens (token, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)`,
        [token, userId, Date.now(), expiresAt]
      );
    },
    async getResetToken(token) {
      const { rows } = await pool.query(`SELECT * FROM password_reset_tokens WHERE token = $1`, [token]);
      return rows[0] || null;
    },
    async deleteResetToken(token) {
      await pool.query(`DELETE FROM password_reset_tokens WHERE token = $1`, [token]);
    },
    async deleteResetTokensByUser(userId) {
      await pool.query(`DELETE FROM password_reset_tokens WHERE user_id = $1`, [userId]);
    },

    async getAllUsers() {
      const { rows } = await pool.query(`SELECT id, email, full_name, role, created_at FROM users ORDER BY created_at DESC`);
      return rows;
    },
    async getAllOrdersWithOwner() {
      const { rows } = await pool.query(`
        SELECT orders.*, users.email AS owner_email, users.full_name AS owner_full_name
        FROM orders JOIN users ON users.id = orders.user_id
        ORDER BY orders.created_at DESC
      `);
      return rows;
    },
    async getAdminStats() {
      const [userCount, orderCount, statusCounts, revenue, last7, last30] = await Promise.all([
        pool.query('SELECT COUNT(*)::int AS c FROM users'),
        pool.query('SELECT COUNT(*)::int AS c FROM orders'),
        pool.query('SELECT status, COUNT(*)::int AS c FROM orders GROUP BY status'),
        // Canceled orders never completed, so they're excluded from revenue.
        pool.query("SELECT COALESCE(SUM(price * quantity + tax + shipping), 0) AS total FROM orders WHERE status != 'Canceled'"),
        pool.query('SELECT COUNT(*)::int AS c FROM orders WHERE created_at >= $1', [Date.now() - 7 * 24 * 60 * 60 * 1000]),
        pool.query('SELECT COUNT(*)::int AS c FROM orders WHERE created_at >= $1', [Date.now() - 30 * 24 * 60 * 60 * 1000])
      ]);
      const ordersByStatus = {};
      for (const status of STATUSES) ordersByStatus[status] = 0;
      for (const row of statusCounts.rows) ordersByStatus[row.status] = row.c;
      return {
        totalAccounts: userCount.rows[0].c,
        totalOrders: orderCount.rows[0].c,
        ordersByStatus,
        totalRevenue: Number(revenue.rows[0].total) || 0,
        ordersLast7Days: last7.rows[0].c,
        ordersLast30Days: last30.rows[0].c
      };
    },
    async getMarketplaceBreakdown() {
      const { rows } = await pool.query('SELECT link, price, quantity, tax, shipping, status FROM orders');
      const byDomain = {};
      for (const o of rows) {
        // Every order's link is validated as a real URL at creation time (orders.routes.js),
        // but the try/catch stays as a defensive fallback for any that somehow aren't.
        let domain = 'Unknown';
        try { domain = new URL(o.link).hostname.replace(/^www\./, ''); } catch { /* leave as Unknown */ }
        if (!byDomain[domain]) byDomain[domain] = { domain, orderCount: 0, revenue: 0 };
        byDomain[domain].orderCount += 1;
        if (o.status !== 'Canceled') {
          byDomain[domain].revenue += Number(o.price) * Number(o.quantity) + Number(o.tax) + Number(o.shipping);
        }
      }
      return Object.values(byDomain).sort((a, b) => b.orderCount - a.orderCount);
    }
  };
}
