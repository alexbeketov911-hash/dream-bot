import Database from 'better-sqlite3';

const db = new Database('dream-bot.db');

// WAL быстрее и безопаснее при одновременном чтении/записи
// Foreign keys включаем явно, иначе SQLite их игнорирует
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    telegram_id INTEGER PRIMARY KEY,
    plan TEXT NOT NULL DEFAULT 'free',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (telegram_id) REFERENCES users(telegram_id)
  );

  CREATE INDEX IF NOT EXISTS idx_messages_telegram ON messages(telegram_id);
`);

export const CONTEXT_LIMITS = {
  free: 10,
  paid: 50,
};

export function ensureUser(telegramId) {
  db.prepare('INSERT OR IGNORE INTO users (telegram_id) VALUES (?)').run(telegramId);
}

export function getPlan(telegramId) {
  const row = db.prepare('SELECT plan FROM users WHERE telegram_id = ?').get(telegramId);
  return row ? row.plan : 'free';
}

export function setPlan(telegramId, plan) {
  ensureUser(telegramId);
  db.prepare('UPDATE users SET plan = ? WHERE telegram_id = ?').run(plan, telegramId);
}

export function saveMessage(telegramId, role, content) {
  ensureUser(telegramId);
  db.prepare('INSERT INTO messages (telegram_id, role, content) VALUES (?, ?, ?)').run(
    telegramId,
    role,
    content
  );
}

export function getHistoryForContext(telegramId) {
  const limit = CONTEXT_LIMITS[getPlan(telegramId)] ?? CONTEXT_LIMITS.free;
  const rows = db
    .prepare(
      'SELECT role, content FROM messages WHERE telegram_id = ? ORDER BY id DESC LIMIT ?'
    )
    .all(telegramId, limit);
  return rows.reverse();
}

export function clearHistory(telegramId) {
  db.prepare('DELETE FROM messages WHERE telegram_id = ?').run(telegramId);
}

// Именованный экспорт для graceful shutdown в index.js
export { db };

export default db;
