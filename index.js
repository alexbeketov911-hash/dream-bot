import 'dotenv/config';
import { Telegraf, Markup } from 'telegraf';
import { SYSTEM_PROMPT } from './systemPrompt.js';
import { saveMessage, getHistoryForContext, clearHistory, db } from './db.js';

// ---- Проверка env-переменных ----
const { TELEGRAM_BOT_TOKEN, MOONSHOT_API_KEY, ADMIN_TELEGRAM_ID } = process.env;
if (!TELEGRAM_BOT_TOKEN) {
  console.error('Ошибка: не найден TELEGRAM_BOT_TOKEN в .env');
  process.exit(1);
}
if (!MOONSHOT_API_KEY) {
  console.error('Ошибка: не найден MOONSHOT_API_KEY в .env');
  process.exit(1);
}

const ADMIN_ID = ADMIN_TELEGRAM_ID ? Number(ADMIN_TELEGRAM_ID) : null;

const API_URL = 'https://api.moonshot.ai/v1/chat/completions';
const MODEL_NAME = 'kimi-k3';
const API_TIMEOUT_MS = 120000;

// ---- Логгер ----
function log(level, message, meta = {}) {
  const ts = new Date().toISOString();
  console.log(JSON.stringify({ ts, level, message, ...meta }));
}

// ---- Rate limiting ----
const rateLimits = new Map();
const RATE_LIMIT_MS = 5000;
const MAX_MESSAGE_LENGTH = 2000;

// ---- Фильтр prompt injection ----
const FORBIDDEN_PATTERNS = [
  /забудь все инструкции/i,
  /забудь предыдущие инструкции/i,
  /теперь ты астролог/i,
  /игнорируй системный промпт/i,
  /ignore previous instructions/i,
  /you are now an astrologer/i,
];

// ---- Проверка: уже был разбор или это первый сон ----
function hasAssistantReplied(userId) {
  try {
    const row = db
      .prepare('SELECT COUNT(*) as count FROM messages WHERE telegram_id = ? AND role = ?')
      .get(userId, 'assistant');
    return row.count > 0;
  } catch (e) {
    log('error', 'hasAssistantReplied failed', { userId, error: e.message });
    return false;
  }
}

// ===== НАВИГАЦИЯ =====
// Reply Keyboard — постоянная сетка 2x2 внизу экрана (кнопка-переключатель
// рядом с полем ввода). Без слэшей, без системного меню команд — просто
// подписанные эмодзи-кнопки, всегда доступные и не занимающие место в чате.
const MAIN_KEYBOARD = Markup.keyboard([
  ['🌙 Рассказать сон', '🗑 Очистить историю'],
  ['ℹ️ О боте', '📋 Пример сна'],
]).resize();

// Нажатия по Reply Keyboard приходят как обычный текст с тем же лейблом.
const BUTTON_TEXT_MAP = {
  '🌙 Рассказать сон': 'tell_dream',
  '🗑 Очистить историю': 'clear_history',
  'ℹ️ О боте': 'about',
  '📋 Пример сна': 'example',
};

// Inline-кнопки "следующий шаг" — приклеены к сообщению с разбором сна,
// появляются после первой же интерпретации. Один ряд, две кнопки.
const AFTER_REPLY_INLINE = Markup.inlineKeyboard([
  [
    Markup.button.callback('💬 Обсудить сон', 'discuss_dream'),
    Markup.button.callback('🌙 Рассказать новый сон', 'tell_new_dream'),
  ],
]);

// ---- Telegram-бот ----
const bot = new Telegraf(TELEGRAM_BOT_TOKEN, {
  handlerTimeout: 150000,
});

bot.catch((err, ctx) => {
  log('error', 'Telegraf global error', {
    error: err?.message || String(err),
    userId: ctx?.from?.id,
  });
  try {
    ctx.reply('Произошла внутренняя ошибка. Попробуй ещё раз или очисти историю.');
  } catch {}
});

const BLACKLIST = new Set();
bot.use((ctx, next) => {
  if (!ctx.from) return next();
  if (BLACKLIST.has(ctx.from.id)) return;
  return next();
});

// ===== ТЕКСТЫ =====

const START_TEXT = `🌙 Добро пожаловать в Мир Сновидений

Я — твой проводник в бессознательное.

Сон — это не хаотичный набор образов. Это язык, на котором говорит твоя глубинная часть: о переживаниях, которые ты заметил, и о тех, что прячутся за повседневной суетой. О страхах, желаниях, нерешённых конфликтах и скрытых ресурсах.

Их обнаружение и проработка могут помочь разобраться в себе, снять внутреннее напряжение и найти ответы, которые днём кажутся недостижимыми.

Если ты практикующий психолог - я могу помочь с интерпретацией снов клиента. При формировании ответа - бот обращается к методам аналитической психологии, гештальт-терапии, экзистенциальной психологии, КПТ

Расскажи сон как можно подробнее: место, действие, персонажи, эмоции во сне и сразу после пробуждения. Чем ярче детали — тем глубже будет разбор.

⚠️ Важно: я не врач не психолог и не психотерапевт. Если тебя беспокоят тревожные сны, бессонница или состояние ухудшается — обратись к специалисту.

⚠️ Важно: у меня нет всего контекста твоей жизни и особенностей психики - мои ответы лишь рассуждения и могут не быть правдивыми, даже если таковыми кажутся. Создатели бота не несут ответственность за твои решения, принятые по результатам общения с ботом. При сомнениях и тревоге - обратись к профессиональному психологу

🔒 Обрати внимание: переписка сохраняется и может анализироваться в целях улучшения качества ответов бота.`;

const ABOUT_TEXT = `ℹ️ Кто я такой

Я помогаю разобраться в сновидениях через призму научной психологии:

🧠 Когнитивно-поведенческая терапия (КПТ)
🔮 Аналитическая психология
🌀 Гештальт-терапия
📚 Экзистенциальная психология

Я не предсказываю будущее, не пользуюсь сонниками и не обращаюсь к эзотерике. Каждый образ в сне — это проекция твоей личности, и мы будем пробовать искать его значение, а не шаблонное толкование.

Если ты практикующий психолог - я могу помочь с интерпретацией снов клиента. При формировании ответа - бот обращается к методам аналитической психологии, гештальт-терапии, экзистенциальной психологии, КПТ

⚠️ Важно: это не замена консультации лицензированного специалиста.

⚠️ Важно: каждая личность многогранна и глубока. У меня нет всего контекста твоей жизни и особенностей психики - мои ответы лишь рассуждения и могут не быть правдивыми, даже если таковыми кажутся. Создатели бота не несут ответственность за твои решения, принятые по результатам общения с ботом. При сомнениях и тревоге - обратись к профессиональному психологу

🔒 Также напоминаю: переписка сохраняется и может анализироваться в целях улучшения качества ответов. Начиная пользоваться ботом, ты соглашаешься со всем вышеописанным.`;

const EXAMPLE_TEXT = `📋 Пример хорошего описания:

«Я шёл по пустынной дороге, вокруг были высокие серые стены. Вдруг увидел старую знакомую дверь, но ручка была горячей. Я испугался, но всё равно открыл её. Внутри было пусто, и я почувствовал глубокое одиночество, а потом проснулся в холодном поту.»

Что важно:
📍 Локация и её атмосфера
🎭 Действие и твоя роль в нём
👤 Персонажи и их отношение к тебе
💭 Эмоции во время сна и сразу после пробуждения
🌡️ Физические ощущения (температура, давление, дыхание)`;

const TELL_DREAM_TEXT = `🌙 Готов слушать.

Опиши свой сон: место, действие, персонажи, эмоции. Чем подробнее - тем точнее будет разбор. Не стесняйся длинных сообщений, но постарайся уложиться в 2000 символов. Помни - не является консультацией специалиста, не является гарантией точности интерпретаций, ввиду отсутствия контекста при многогранности каждой личности. Создатели бота не несут ответственность за твои решения, принятые по результатам общения с ботом. При сомнениях и тревоге - обратись к профессиональному психологу`;

const DISCUSS_TEXT = `💬 Хорошо, давай продолжим.

Задай вопрос по разбору, поделись своими ассоциациями или расскажи, что из ответа резонирует, а что нет. Чем больше обратной связи — тем глубже получится проработка.`;

const CLEAR_TEXT = `🗑 История очищена. Можешь рассказать новый сон.`;

// ===== ОБРАБОТЧИКИ КОМАНД =====
// Команды (/start, /reset и т.д.) продолжают работать, если их набрать
// руками, но в системное меню Telegram не выводятся — навигация теперь
// через Reply Keyboard ниже, без слэшей.

bot.start(async (ctx) => {
  const userId = ctx.from.id;
  clearHistory(userId);
  log('info', 'User started bot', { userId, username: ctx.from.username });
  await ctx.reply(START_TEXT, MAIN_KEYBOARD);
});

bot.command('reset', async (ctx) => {
  const userId = ctx.from.id;
  clearHistory(userId);
  log('info', 'History reset by command', { userId });
  await ctx.reply(CLEAR_TEXT, MAIN_KEYBOARD);
});

bot.command('about', async (ctx) => {
  await ctx.reply(ABOUT_TEXT);
});

bot.command('example', async (ctx) => {
  await ctx.reply(EXAMPLE_TEXT);
});

bot.command('stop', async (ctx) => {
  if (!ADMIN_ID || ctx.from.id !== ADMIN_ID) {
    return ctx.reply('Эта команда только для администратора.');
  }
  await ctx.reply('Бот останавливается...');
  log('warn', 'Emergency stop by admin', { adminId: ADMIN_ID });
  db.close();
  await bot.stop();
  process.exit(0);
});

// ---- /sessions — только для админа ----
bot.command('sessions', async (ctx) => {
  if (!ADMIN_ID || ctx.from.id !== ADMIN_ID) {
    return ctx.reply('Эта команда только для администратора.');
  }

  try {
    const rows = db.prepare(`
      SELECT u.telegram_id, COUNT(m.id) as msg_count, MAX(m.created_at) as last_active
      FROM users u
      LEFT JOIN messages m ON m.telegram_id = u.telegram_id
      GROUP BY u.telegram_id
      ORDER BY last_active DESC
    `).all();

    if (rows.length === 0) {
      return ctx.reply('📊 Пока нет пользователей.');
    }

    let text = '📊 Статистика пользователей\n\n';
    const buttons = [];

    for (const row of rows) {
      const id = row.telegram_id;
      const count = row.msg_count;
      const last = row.last_active || '—';
      text += `👤 ID: ${id}\n   Сообщений: ${count}\n   Активность: ${last}\n\n`;
      buttons.push([Markup.button.callback(`👤 ${id} (${count})`, `view_session_${id}`)]);
    }

    await ctx.reply(text, Markup.inlineKeyboard(buttons));
  } catch (e) {
    log('error', '/sessions error', { error: e.message });
    await ctx.reply('Ошибка при получении статистики.');
  }
});

// ===== INLINE-ДЕЙСТВИЯ =====

bot.action('discuss_dream', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(DISCUSS_TEXT);
});

bot.action('tell_new_dream', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(TELL_DREAM_TEXT);
});

// ---- Просмотр переписки конкретного пользователя (только админ) ----
bot.action(/view_session_(\d+)/, async (ctx) => {
  if (!ADMIN_ID || ctx.from.id !== ADMIN_ID) {
    await ctx.answerCbQuery('Нет доступа');
    return;
  }

  const targetId = Number(ctx.match[1]);
  await ctx.answerCbQuery();

  try {
    const messages = db.prepare(
      'SELECT role, content, created_at FROM messages WHERE telegram_id = ? ORDER BY id ASC'
    ).all(targetId);

    if (messages.length === 0) {
      return ctx.reply('Сообщений не найдено.');
    }

    let text = `📋 Переписка с ${targetId}:\n\n`;
    for (const m of messages) {
      const who = m.role === 'user' ? '👤' : '🤖';
      text += `${who} [${m.created_at}]\n${m.content}\n\n`;
      if (text.length > 3500) break; // не превышаем лимит
    }

    await ctx.reply(text.slice(0, 4000));
  } catch (e) {
    log('error', 'view_session error', { targetId, error: e.message });
    await ctx.reply('Ошибка при загрузке переписки.');
  }
});

// ===== ОСНОВНОЙ ОБРАБОТЧИК ТЕКСТА =====

bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const userText = ctx.message.text;

  // Нажатие по кнопке Reply Keyboard — приходит как обычный текст с тем же лейблом
  const buttonAction = BUTTON_TEXT_MAP[userText];
  if (buttonAction) {
    log('info', 'Keyboard button pressed', { userId, buttonAction });
    if (buttonAction === 'tell_dream') return ctx.reply(TELL_DREAM_TEXT);
    if (buttonAction === 'clear_history') {
      clearHistory(userId);
      return ctx.reply(CLEAR_TEXT, MAIN_KEYBOARD);
    }
    if (buttonAction === 'about') return ctx.reply(ABOUT_TEXT);
    if (buttonAction === 'example') return ctx.reply(EXAMPLE_TEXT);
  }

  // Rate limit
  const now = Date.now();
  const last = rateLimits.get(userId);
  if (last && now - last < RATE_LIMIT_MS) {
    const wait = Math.ceil((RATE_LIMIT_MS - (now - last)) / 1000);
    return ctx.reply(`Слишком быстро. Подожди ${wait} сек.`);
  }
  rateLimits.set(userId, now);

  // Валидация длины
  if (userText.length > MAX_MESSAGE_LENGTH) {
    return ctx.reply(
      `Слишком длинное сообщение. Максимум ${MAX_MESSAGE_LENGTH} символов. Попробуй разбить сон на части или сократить описание.`
    );
  }

  // Фильтр prompt injection
  if (FORBIDDEN_PATTERNS.some((p) => p.test(userText))) {
    log('warn', 'Prompt injection attempt', { userId, text: userText.slice(0, 100) });
    return ctx.reply('Давай вернёмся к разбору сна. Если хочешь начать заново — очисти историю.');
  }

  // Определяем: первый сон или обсуждение
  const isFirstDream = !hasAssistantReplied(userId);

  saveMessage(userId, 'user', userText);
  log('info', 'Message received', { userId, length: userText.length, isFirstDream });

  // Показываем "печатает..." и отправляем сообщение "думаю"
  await ctx.sendChatAction('typing');
  let thinkingMsg;
  try {
    const thinkingText = isFirstDream
      ? '🤔 Думаю над твоим сном...'
      : '🤔 Думаю над твоими мыслями...';
    thinkingMsg = await ctx.reply(thinkingText);
  } catch (e) {
    log('warn', 'Failed to send thinking message', { userId, error: e.message });
  }

  try {
    const history = getHistoryForContext(userId);
    log('info', 'Sending request to API', { userId, historyLength: history.length });

    const reply = await askKimi(history);
    if (!reply) throw new Error('Empty reply from API');

    saveMessage(userId, 'assistant', reply);
    log('info', 'Reply received', { userId, replyLength: reply.length });

    if (thinkingMsg?.message_id) {
      await ctx.deleteMessage(thinkingMsg.message_id).catch(() => {});
    }
    // Инлайн-кнопки "Обсудить / Новый сон" клеим к разбору начиная с самого
    // первого ответа — с этого момента у пользователя уже есть что обсуждать.
    await sendLongMessage(ctx, reply);
  } catch (error) {
    const isTimeout = error?.name === 'AbortError';
    log('error', 'API error', {
      userId,
      isTimeout,
      error: error?.message || String(error),
    });

    const errorText = '⏱️ Не удалось получить ответ — сервер перегружен или временные ограничения. Попробуй ещё раз через минуту.';
    if (thinkingMsg?.message_id) {
      try {
        await ctx.telegram.editMessageText(ctx.chat.id, thinkingMsg.message_id, undefined, errorText);
      } catch {
        await ctx.reply(errorText);
      }
    } else {
      await ctx.reply(errorText);
    }
  }
});

// ===== ВЫЗОВ API (AbortController — реально отменяет запрос) =====

async function askKimi(history) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  const startedAt = Date.now();

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MOONSHOT_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL_NAME,
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...history],
        reasoning_effort: 'low',
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    log('info', 'Kimi API responded', { model: MODEL_NAME, elapsedMs: Date.now() - startedAt, status: res.status });

    // Обработка 429 — ждём 2 сек и пробуем ещё раз
    if (res.status === 429) {
      log('warn', 'Got 429, retrying in 2s');
      await sleep(2000);
      return askKimi(history); // 1 retry
    }

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`HTTP ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || null;
  } catch (err) {
    clearTimeout(timeout);
    log('error', 'Kimi API call failed', { model: MODEL_NAME, elapsedMs: Date.now() - startedAt, error: err?.message || String(err) });
    throw err;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ===== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ =====

async function sendLongMessage(ctx, text) {
  const LIMIT = 4000;
  if (text.length <= LIMIT) {
    return ctx.reply(text, AFTER_REPLY_INLINE);
  }
  const parts = [];
  for (let i = 0; i < text.length; i += LIMIT) {
    parts.push(text.slice(i, i + LIMIT));
  }
  for (let i = 0; i < parts.length; i++) {
    const isLast = i === parts.length - 1;
    await ctx.reply(parts[i], isLast ? AFTER_REPLY_INLINE : undefined);
  }
}

bot.launch();
log('info', 'Bot started and listening...');

// Graceful shutdown
process.once('SIGINT', () => {
  log('info', 'SIGINT received, shutting down gracefully');
  db.close();
  bot.stop('SIGINT');
});

process.once('SIGTERM', () => {
  log('info', 'SIGTERM received, shutting down gracefully');
  db.close();
  bot.stop('SIGTERM');
});
