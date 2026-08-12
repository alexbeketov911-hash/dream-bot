# Dream Bot — v1.2

Telegram-бот для психологического анализа сновидений. Работает на базе **Kimi API** (Moonshot AI).

## Возможности

- Психологический разбор снов (КПТ, аналитическая психология, гештальт, экзистенциальная психология)
- Сохранение контекста диалога (SQLite)
- Rate limiting и защита от prompt injection
- Inline-кнопки с динамическим меню

## Локальный запуск

```bash
npm install
# создай .env по шаблону .env.example
npm start
```

## Деплой на Railway

### 1. Подготовка

Убедись, что в репозитории есть:
- `index.js`
- `db.js`
- `systemPrompt.js`
- `package.json`
- `Procfile`
- `.gitignore`

### 2. Регистрация на Railway

1. Зайди на [railway.app](https://railway.app)
2. Нажми **Start a New Project** → **Deploy from GitHub repo**
3. Авторизуй GitHub → выбери репозиторий `dream-bot`
4. Railway автоматически найдёт `package.json` и запустит `npm start`

### 3. Environment Variables

В панели Railway перейди во вкладку **Variables** и добавь:

| Переменная | Значение |
|-----------|----------|
| `TELEGRAM_BOT_TOKEN` | твой токен от @BotFather |
| `MOONSHOT_API_KEY` | ключ с platform.moonshot.cn |
| `ADMIN_TELEGRAM_ID` | твой Telegram ID |

### 4. Запуск

Нажми **Deploy**. Railway выдаст URL (например, `dream-bot.up.railway.app`). Бот начнёт работать.

⚠️ **Важно:** на бесплатном плане Railway:
- 500 часов в месяц (~20 дней)
- При перезапуске SQLite-база обнуляется (история переписок теряется)
- Для постоянной работы с сохранением данных рассмотри VPS

## Структура проекта

| Файл | Назначение |
|------|-----------|
| `index.js` | Основная логика бота |
| `db.js` | SQLite: пользователи, сообщения, планы |
| `systemPrompt.js` | Системный промпт для Kimi API |
| `viewSessions.js` | Утилита для просмотра переписок |
| `Procfile` | Инструкция запуска для Railway |
