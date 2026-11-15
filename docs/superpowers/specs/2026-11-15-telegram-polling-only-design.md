# Polling-only Telegram bot

## Цель

Удалить неиспользуемый webhook-режим после окончательного перехода бота на polling, сохранив PWA Drive API и возможность отключить ранее настроенный webhook.

## Решение

- Удалить `setupTelegramWebhook()`, `_telegramHandleUpdate()` и Telegram-ветку `message`/`callback_query` из `doPost()`.
- Удалить использование `TELEGRAM_WEBHOOK_SECRET` и `TELEGRAM_EXEC_URL` из кода, фикстур и актуальной документации. Старые свойства в Apps Script можно удалить вручную; миграция не нужна.
- Сохранить `deleteTelegramWebhook()`: `setupTelegramPolling()` и `disableTelegram()` должны по-прежнему отключать старую конфигурацию.
- Тесты Telegram-расходов и отмены вызывают реальные `_telegramHandleMessage()` и `_telegramUndo()` напрямую. Проверки доступа используют публичный `pollTelegramUpdates()`.
- Drive `doPost` обрабатывает только sync actions; Telegram update получает обычный `Unknown action` без Bot API и записи Drive.
- Обновить PWA до `v1.91.3` и service worker cache, чтобы offline-копирование отдавало новый код. `VERSION` Apps Script остаётся `11.2`, sync protocol не меняется.

## Нецели

- Не менять polling, клавиатуру, расходы, tombstones, merge, Drive backups и Mini App.
- Не удалять `deleteTelegramWebhook()` и не отключать существующий polling-триггер.
- Не менять исторические документы предыдущих функций.

## Проверка

- Новый тест отсутствия webhook-обработчика падает до удаления и проходит после.
- Существующие сценарии расходов, отмены, ошибок Bot API, доступа и Drive sync сохраняют покрытие.
- `node tools/gs-check.mjs`, полный `dt-check` и syntax check проходят.
