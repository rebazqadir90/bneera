import { DatabaseSync } from 'node:sqlite';

export const STATUSES = [
  'Pending', 'Processed', 'Confirmed', 'Purchased', 'Received',
  'Shipped To Iraq', 'Arrived', 'Delivered', 'Canceled'
];

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL COLLATE NOCASE,
  full_name     TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  avatar        TEXT NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS orders (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status     TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN (
               'Pending','Processed','Confirmed','Purchased','Received',
               'Shipped To Iraq','Arrived','Delivered','Canceled')),
  created_at INTEGER NOT NULL,
  link       TEXT NOT NULL,
  quantity   INTEGER NOT NULL CHECK (quantity > 0),
  size       TEXT NOT NULL DEFAULT '',
  color      TEXT NOT NULL DEFAULT '',
  note       TEXT NOT NULL DEFAULT '',
  image      TEXT NOT NULL DEFAULT '',
  price      REAL NOT NULL DEFAULT 0,
  tax        REAL NOT NULL DEFAULT 0,
  tax_rate   REAL NOT NULL DEFAULT 0,
  shipping   REAL NOT NULL DEFAULT 0,
  weight     REAL NOT NULL DEFAULT 0,
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
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS shipping_profiles (
  user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL,
  last_name  TEXT NOT NULL,
  address    TEXT NOT NULL,
  city       TEXT NOT NULL,
  phone      TEXT NOT NULL,
  phone2     TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reset_tokens_user_id ON password_reset_tokens(user_id);
`;

function addColumnIfMissing(db, table, columnDdl) {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${columnDdl}`);
  } catch (err) {
    if (!String(err.message).includes('duplicate column')) throw err;
  }
}

export function openDb(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA);
  // Migrations for databases created before these columns existed.
  addColumnIfMissing(db, 'users', `avatar TEXT NOT NULL DEFAULT ''`);
  addColumnIfMissing(db, 'orders', `tax_rate REAL NOT NULL DEFAULT 0`);
  addColumnIfMissing(db, 'orders', `ship_first_name TEXT NOT NULL DEFAULT ''`);
  addColumnIfMissing(db, 'orders', `ship_last_name TEXT NOT NULL DEFAULT ''`);
  addColumnIfMissing(db, 'orders', `ship_address TEXT NOT NULL DEFAULT ''`);
  addColumnIfMissing(db, 'orders', `ship_city TEXT NOT NULL DEFAULT ''`);
  addColumnIfMissing(db, 'orders', `ship_phone TEXT NOT NULL DEFAULT ''`);
  addColumnIfMissing(db, 'orders', `ship_phone2 TEXT NOT NULL DEFAULT ''`);
  return db;
}

// Matches the frontend's own generateId() convention: Date.now().toString(36) + 3 random base36 chars, upper-cased.
function makeOrderId() {
  const rand = Math.random().toString(36).slice(2, 5);
  return (Date.now().toString(36) + rand).toUpperCase();
}

export function createStatements(db) {
  const insertUserStmt = db.prepare(
    `INSERT INTO users (email, full_name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)`
  );
  const getUserByEmailStmt = db.prepare(`SELECT * FROM users WHERE email = ? COLLATE NOCASE`);
  const getUserByIdStmt = db.prepare(`SELECT * FROM users WHERE id = ?`);

  const insertSessionStmt = db.prepare(
    `INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`
  );
  const getSessionStmt = db.prepare(`SELECT * FROM sessions WHERE id = ?`);
  const touchSessionStmt = db.prepare(`UPDATE sessions SET expires_at = ? WHERE id = ?`);
  const deleteSessionStmt = db.prepare(`DELETE FROM sessions WHERE id = ?`);
  const deleteExpiredSessionsStmt = db.prepare(`DELETE FROM sessions WHERE expires_at < ?`);

  const insertOrderStmt = db.prepare(`
    INSERT INTO orders (id, user_id, status, created_at, link, quantity, size, color, note, image, price, tax, tax_rate, shipping, weight)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const getOrdersByUserStmt = db.prepare(`SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC`);
  const getOrderByIdStmt = db.prepare(`SELECT * FROM orders WHERE id = ?`);
  const updateOrderStatusStmt = db.prepare(`UPDATE orders SET status = ? WHERE id = ?`);
  const updateOrderDetailsStmt = db.prepare(
    `UPDATE orders SET weight = ?, price = ?, tax = ?, tax_rate = ?, shipping = ? WHERE id = ?`
  );
  const confirmOrderWithShippingStmt = db.prepare(`
    UPDATE orders SET status = 'Confirmed',
      ship_first_name = ?, ship_last_name = ?, ship_address = ?, ship_city = ?, ship_phone = ?, ship_phone2 = ?
    WHERE id = ?
  `);

  const insertLeadStmt = db.prepare(`INSERT INTO leads (email, created_at) VALUES (?, ?)`);

  const getShippingProfileStmt = db.prepare(`SELECT * FROM shipping_profiles WHERE user_id = ?`);
  const upsertShippingProfileStmt = db.prepare(`
    INSERT INTO shipping_profiles (user_id, first_name, last_name, address, city, phone, phone2, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      first_name = excluded.first_name, last_name = excluded.last_name, address = excluded.address,
      city = excluded.city, phone = excluded.phone, phone2 = excluded.phone2, updated_at = excluded.updated_at
  `);

  const updateUserPasswordStmt = db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`);
  const updateUserAvatarStmt = db.prepare(`UPDATE users SET avatar = ? WHERE id = ?`);
  const deleteSessionsByUserStmt = db.prepare(`DELETE FROM sessions WHERE user_id = ?`);
  const deleteOtherSessionsStmt = db.prepare(`DELETE FROM sessions WHERE user_id = ? AND id != ?`);

  const insertResetTokenStmt = db.prepare(
    `INSERT INTO password_reset_tokens (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`
  );
  const getResetTokenStmt = db.prepare(`SELECT * FROM password_reset_tokens WHERE token = ?`);
  const deleteResetTokenStmt = db.prepare(`DELETE FROM password_reset_tokens WHERE token = ?`);
  const deleteResetTokensByUserStmt = db.prepare(`DELETE FROM password_reset_tokens WHERE user_id = ?`);

  const getAllUsersStmt = db.prepare(`SELECT id, email, full_name, role, created_at FROM users ORDER BY created_at DESC`);
  const getAllOrdersWithOwnerStmt = db.prepare(`
    SELECT orders.*, users.email AS owner_email, users.full_name AS owner_full_name
    FROM orders JOIN users ON users.id = orders.user_id
    ORDER BY orders.created_at DESC
  `);

  return {
    insertUser({ email, fullName, passwordHash, role = 'user' }) {
      const info = insertUserStmt.run(email, fullName, passwordHash, role, Date.now());
      return getUserByIdStmt.get(Number(info.lastInsertRowid));
    },
    getUserByEmail(email) {
      return getUserByEmailStmt.get(email);
    },
    getUserById(id) {
      return getUserByIdStmt.get(id);
    },

    insertSession({ id, userId, expiresAt }) {
      insertSessionStmt.run(id, userId, Date.now(), expiresAt);
    },
    getSession(id) {
      return getSessionStmt.get(id);
    },
    touchSession(id, expiresAt) {
      touchSessionStmt.run(expiresAt, id);
    },
    deleteSession(id) {
      deleteSessionStmt.run(id);
    },
    deleteExpiredSessions() {
      deleteExpiredSessionsStmt.run(Date.now());
    },

    insertOrder({ userId, status = 'Pending', link, quantity, size = '', color = '', note = '', image = '' }) {
      const now = Date.now();
      for (let attempt = 0; attempt < 5; attempt++) {
        const id = makeOrderId();
        try {
          insertOrderStmt.run(id, userId, status, now, link, quantity, size, color, note, image, 0, 0, 0, 0, 0);
          return getOrderByIdStmt.get(id);
        } catch (err) {
          if (String(err.message).includes('UNIQUE constraint failed') && attempt < 4) continue;
          throw err;
        }
      }
      throw new Error('Failed to generate a unique order id');
    },
    getOrdersByUser(userId) {
      return getOrdersByUserStmt.all(userId);
    },
    confirmOrderWithShipping(id, { firstName, lastName, address, city, phone, phone2 }) {
      confirmOrderWithShippingStmt.run(firstName, lastName, address, city, phone, phone2, id);
      return getOrderByIdStmt.get(id);
    },
    getShippingProfile(userId) {
      return getShippingProfileStmt.get(userId);
    },
    upsertShippingProfile(userId, { firstName, lastName, address, city, phone, phone2 }) {
      upsertShippingProfileStmt.run(userId, firstName, lastName, address, city, phone, phone2, Date.now());
      return getShippingProfileStmt.get(userId);
    },
    getOrderById(id) {
      return getOrderByIdStmt.get(id);
    },
    updateOrderStatus(id, status) {
      updateOrderStatusStmt.run(status, id);
      return getOrderByIdStmt.get(id);
    },
    // weight/price/shipping are absolute values; taxRate is a PERCENTAGE (e.g. 5 = 5%).
    // tax is always re-derived here as price * quantity * taxRate / 100, so it self-corrects
    // whenever price or taxRate changes later, instead of drifting out of sync.
    updateOrderDetails(id, { weight, price, taxRate, shipping }) {
      const existing = getOrderByIdStmt.get(id);
      const effectivePrice = price;
      const effectiveTaxRate = taxRate;
      const tax = effectivePrice * existing.quantity * (effectiveTaxRate / 100);
      updateOrderDetailsStmt.run(weight, effectivePrice, tax, effectiveTaxRate, shipping, id);
      return getOrderByIdStmt.get(id);
    },

    insertLead({ email }) {
      insertLeadStmt.run(email, Date.now());
    },

    updateUserPassword(userId, passwordHash) {
      updateUserPasswordStmt.run(passwordHash, userId);
    },
    updateUserAvatar(userId, avatarPath) {
      updateUserAvatarStmt.run(avatarPath, userId);
      return getUserByIdStmt.get(userId);
    },
    deleteSessionsByUser(userId) {
      deleteSessionsByUserStmt.run(userId);
    },
    deleteOtherSessions(userId, keepSessionId) {
      deleteOtherSessionsStmt.run(userId, keepSessionId);
    },

    insertResetToken({ token, userId, expiresAt }) {
      insertResetTokenStmt.run(token, userId, Date.now(), expiresAt);
    },
    getResetToken(token) {
      return getResetTokenStmt.get(token);
    },
    deleteResetToken(token) {
      deleteResetTokenStmt.run(token);
    },
    deleteResetTokensByUser(userId) {
      deleteResetTokensByUserStmt.run(userId);
    },

    getAllUsers() {
      return getAllUsersStmt.all();
    },
    getAllOrdersWithOwner() {
      return getAllOrdersWithOwnerStmt.all();
    }
  };
}
