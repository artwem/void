# Telegram Polling-Only Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Удалить webhook-режим Telegram-бота, сохранив polling, отключение старого webhook и Drive-синхронизацию.

**Architecture:** `Code.gs` обслуживает только Drive API. `Telegram.gs` получает обновления исключительно через `pollTelegramUpdates()`; `deleteTelegramWebhook()` остаётся cleanup-операцией для старой конфигурации.

**Tech Stack:** Apps Script V8, Node VM tests, существующий Puppeteer runner.

**Spec:** `docs/superpowers/specs/2026-11-15-telegram-polling-only-design.md`

## Global Constraints

- `VERSION='11.2'` и PWA sync protocol не меняются; PWA становится `v1.91.3`.
- Сохранить `deleteTelegramWebhook()` и её вызовы из setup/disable.
- Не менять финансовые записи, Script Properties пользователя или polling-триггеры.
- Не добавлять зависимости.

## Review Focus

- Старый webhook ещё установлен: setup/disable продолжают отправлять `deleteWebhook`; проверяется существующими тестами в Task 1.
- Чужой пользователь или группа: polling не читает Drive и не отвечает, но подтверждает update offset; проверяется в Task 1.
- Ошибка Bot API после commit: прямой handler выбрасывает ошибку, повтор идемпотентен; сохранённые проверки адаптируются в Task 1.
- Offline copy: обновлённые файлы попадают в новый cache `v1.91.3`; проверяется полным browser suite в Task 1.

---

### Task 1: Удалить webhook-режим и сохранить polling coverage

**Files:**
- Modify: `apps-script/Code.gs`
- Modify: `apps-script/Telegram.gs`
- Modify: `tools/gs-check.mjs`
- Modify: `index.html`, `sw.js`
- Modify: `README.md`, `AGENTS.md`, `CLAUDE.md`

**Interfaces:**
- Preserves: `pollTelegramUpdates()`, `deleteTelegramWebhook()`, `disableTelegram()`, `setupTelegramPolling()` без изменения сигнатур.
- Removes: `setupTelegramWebhook()`, `_telegramHandleUpdate(body, parameters)`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_EXEC_URL`.
- Test entry points: `_telegramHandleMessage(message)`, `_telegramUndo(callbackQuery)`, `pollTelegramUpdates()`.

- [ ] **Step 1: Адаптировать тесты и добавить failing-проверку отсутствия webhook route**

Удалить setup webhook проверки и secret-specific fixtures. Все Telegram message/callback сценарии перевести с `post()` на прямые handlers; ошибки Bot API проверять через throw/retry. Доступ проверять через polling updates. В backend test вместо `ok:true` ожидать `Unknown action` без Bot API/Drive-записи — до реализации это FAIL.

- [ ] **Step 2: Запустить серверные тесты до удаления**

Run: `node tools/gs-check.mjs`
Expected: FAIL на Telegram update в `doPost`; несвязанных падений нет.

- [ ] **Step 3: Удалить webhook production code**

Удалить Telegram-ветку из `doPost`, `_telegramHandleUpdate` и `setupTelegramWebhook`. Сохранить `deleteTelegramWebhook` и остальные handlers без изменений.

- [ ] **Step 4: Запустить серверные проверки**

Run: `node tools/gs-check.mjs`
Expected: все оставшиеся и новые проверки PASS.

- [ ] **Step 5: Обновить cache и документацию**

Установить About/service worker `v1.91.3`, обновить текущую версию в `AGENTS.md`. В `README.md`, `AGENTS.md`, `CLAUDE.md` описать polling-only и сохранённое отключение старого webhook. Не менять `VERSION` Apps Script.

- [ ] **Step 6: Полная проверка**

Run: `node tools/gs-check.mjs`
Run: `CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node tools/dt-check.mjs`
Run: проектный inline syntax check и `git diff --check`.
Expected: все команды PASS; в git только файлы этой очистки.
