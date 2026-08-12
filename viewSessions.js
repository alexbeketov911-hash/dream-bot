// Утилита для чтения переписок из базы — не часть самого бота, запускается отдельно.
//
// Использование:
//   node viewSessions.js               — список всех пользователей и кол-во сообщений
//   node viewSessions.js <telegram_id> — полная переписка конкретного пользователя
//
// Если бот развёрнут на хостинге — сначала скачай файл dream-bot.db на свой
// компьютер (например, через SFTP/панель хостинга), потом запускай эту команду
// рядом с ним локально.

import Database from 'better-sqlite3';

const db = new Database('dream-bot.db', { readonly: true });
const targetId = process.argv[2];

if (!targetId) {
  const users = db
    .prepare(
      `SELECT u.telegram_id, u.plan, u.created_at, COUNT(m.id) as message_count
       FROM users u LEFT JOIN messages m ON m.telegram_id = u.telegram_id
       GROUP BY u.telegram_id
       ORDER BY u.created_at DESC`
    )
    .all();

  console.log(`Всего пользователей: ${users.length}\n`);
  for (const u of users) {
    console.log(
      `telegram_id: ${u.telegram_id} | план: ${u.plan} | сообщений: ${u.message_count} | зарегистрирован: ${u.created_at}`
    );
  }
  console.log('\nЧтобы посмотреть переписку конкретного пользователя:');
  console.log('  node viewSessions.js <telegram_id>');
} else {
  const messages = db
    .prepare('SELECT role, content, created_at FROM messages WHERE telegram_id = ? ORDER BY id ASC')
    .all(targetId);

  if (messages.length === 0) {
    console.log('Сообщений не найдено для этого telegram_id.');
  } else {
    for (const m of messages) {
      const who = m.role === 'user' ? 'Пользователь' : 'Бот';
      console.log(`\n[${m.created_at}] ${who}:\n${m.content}`);
    }
  }
}

db.close();
