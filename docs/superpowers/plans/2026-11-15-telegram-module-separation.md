# Telegram Module Separation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Вынести Telegram-бота в отдельный Apps Script-файл и добавить полное отключение бота без влияния на PWA и Drive-синхронизацию.

**Architecture:** Один Apps Script-проект и один глобальный контекст сохраняются. `Code.gs` владеет Drive backend и содержит два необязательных вызова Telegram-модуля; `Telegram.gs` содержит весь bot-specific код и использует общие storage helpers.

**Tech Stack:** Google Apps Script V8, Node.js VM tests, существующий `tools/gs-check.mjs` без новых зависимостей.

**Spec:** `docs/superpowers/specs/2026-11-15-telegram-module-separation-design.md`

## Global Constraints

- Не менять протокол синхронизации, `VERSION = '11.2'`, `APPS_SCRIPT_VERSION`, версию PWA и `sw.js`.
- Сохранить `LockService`, защиту от маленького push, SHA-256 short-circuit и семь суточных копий.
- `disableTelegram()` не удаляет Script Properties, расходы или резервные копии.
- Не использовать реальные токены или финансовые данные в коде и тестах.
- Не добавлять зависимости и не менять клиентский Telegram Mini App.

## Review Focus

- Повторное отключение и несколько polling-триггеров: удаляются все polling-триггеры, посторонние триггеры остаются; это проверяется в Task 1, Steps 1–4.
- Ошибка `deleteWebhook`: polling уже остановлен, ошибка не скрывается; это проверяется в Task 1, Steps 1–4.
- Backend без Telegram-файла: push/pull работают, Telegram update получает безопасный `ok`; это проверяется в Task 2, Steps 3–6.
- Старые расходы бота при совместной установке: существующий LWW merge продолжает выполняться; это проверяется существующими merge-тестами в Task 2, Step 7.
- Повторное включение после отключения: сохранённые Script Properties позволяют снова запустить `setupTelegramPolling()`; это проверяется в Task 1, Steps 1–4.

---

### Task 1: Полное отключение Telegram-бота

**Files:**
- Modify: `apps-script/Code.gs:60-78`
- Modify: `tools/gs-check.mjs:160-175,226-275`
- Modify: `README.md:90-98`

**Interfaces:**
- Produces: `disableTelegram(): undefined` — удаляет все триггеры с handler `pollTelegramUpdates`, затем вызывает существующий `deleteTelegramWebhook()`; настройки и данные не изменяет.
- Test mock: `ScriptApp.deleteTrigger(trigger)` удаляет переданный trigger из `options.triggers`.

- [ ] **Step 1: Написать failing-тесты отключения**

Добавить mock `deleteTrigger` и проверки: `disableTelegram` существует; два polling-триггера удалены, unrelated trigger остался; отправлен `deleteWebhook`; повторный запуск не создаёт ошибок; свойства `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_USER_ID`, `TELEGRAM_WEBHOOK_SECRET` сохранены; после повторного `setupTelegramPolling()` остаётся один polling-триггер. Отдельная проверка при `failTelegram('deleteWebhook')`: функция бросает ошибку Bot API, но polling-триггер уже удалён.

- [ ] **Step 2: Запустить тесты и убедиться в ожидаемом падении**

Run: `node tools/gs-check.mjs`
Expected: FAIL из-за отсутствующего `disableTelegram`/`deleteTrigger`; остальные падения не принимать за ожидаемые.

- [ ] **Step 3: Реализовать минимальное отключение**

В `apps-script/Code.gs` добавить `disableTelegram()` рядом с setup/delete helpers: сначала перебрать копию `ScriptApp.getProjectTriggers()` и удалить каждый polling trigger через `ScriptApp.deleteTrigger`, затем вызвать `deleteTelegramWebhook()`. Не перехватывать ошибку Bot API и не очищать Script Properties.

- [ ] **Step 4: Запустить серверные проверки**

Run: `node tools/gs-check.mjs`
Expected: все проверки PASS.

- [ ] **Step 5: Обновить пользовательскую инструкцию**

В `README.md` заменить упоминание одного только `deleteTelegramWebhook` на полное отключение через `disableTelegram()`: функция удаляет polling-триггеры и webhook, а для повторного включения используется `setupTelegramPolling()`.

### Task 2: Отдельный Telegram.gs при самостоятельном Drive backend

**Files:**
- Create: `apps-script/Telegram.gs`
- Modify: `apps-script/Code.gs`
- Modify: `tools/gs-check.mjs:10-18,179-188`
- Modify: `README.md:90-98,106-120`
- Modify: `AGENTS.md` и `CLAUDE.md` только в описаниях структуры/деплоя, которые после переноса стали неверны.

**Interfaces:**
- Consumes: `disableTelegram()` из Task 1; существующие `getDataFile()`, `backupIfDue()`, `out()`, `FILE_DATA` и `VERSION`.
- Produces: `_telegramHandleUpdate(body, parameters)` возвращает JSON output с `ok:true` после проверки webhook secret, allowed user и обработки update.
- Consumes optionally: `_mergeTelegramExpenses(currentDb, incomingDb)` сохраняет текущую сигнатуру и LWW-семантику.
- Test loader: `loadGs({ telegram:false })` загружает только `Code.gs`; по умолчанию загружает `Code.gs`, затем `Telegram.gs` в один VM context.

- [ ] **Step 1: Научить VM runner загружать оба файла и написать failing-проверку standalone backend**

Импортировать `existsSync`; всегда выполнять `Code.gs`, затем выполнять `Telegram.gs` в том же context при `options.telegram !== false && existsSync(...)`. Для failing-проверки использовать `loadGs({db, telegram:false})` с текущим `Code.gs`. Проверить: Drive `pull` возвращает данные, обычный `push` сохраняет payload, Telegram update возвращает `ok:true` без UrlFetch/Drive-записи. Существующие вызовы `loadGs()` не менять.

- [ ] **Step 2: Запустить новую проверку до переноса**

Run: `node tools/gs-check.mjs`
Expected: standalone Telegram update FAIL, потому что монолитный `Code.gs` всё ещё обращается к Telegram; существующие проверки не должны сломаться.

- [ ] **Step 3: Перенести bot-specific код без изменения алгоритмов**

Создать `apps-script/Telegram.gs` и перенести из `Code.gs` Telegram helpers и handlers (текущие строки 45–389), `disableTelegram()` и `_mergeTelegramExpenses`. Не переносить `doGet`, `getDataFile`, `saveData`, backups, `readData`, `sha256Hex`, `out` и общие константы. После создания файла включить его загрузку в runner по умолчанию.

- [ ] **Step 4: Сделать Telegram-модуль необязательным**

В `doPost` направлять `message`/`callback_query` в `_telegramHandleUpdate(body, e.parameter || {})`, если функция объявлена; при отсутствии модуля вернуть `out({ok:true})`. В `saveData` выполнять parse Drive/incoming и `_mergeTelegramExpenses` только если функция объявлена. Использовать безопасный `typeof functionName === 'function'`, не добавлять fallback-реализации.

- [ ] **Step 5: Запустить серверные проверки**

Run: `node tools/gs-check.mjs`
Expected: все существующие bot/sync и новые standalone-backend проверки PASS.

- [ ] **Step 6: Обновить структуру и деплой в документации**

В `README.md`, `AGENTS.md` и `CLAUDE.md` указать: для бота в один Apps Script-проект копируются `Code.gs` и `Telegram.gs`; для PWA-only Drive backend достаточно `Code.gs`; оба файла используют общий глобальный контекст и одно развёртывание. Не добавлять `Telegram.gs` в PWA precache.

- [ ] **Step 7: Выполнить полную проверку deliverable**

Run: `node tools/gs-check.mjs`
Run: `CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node tools/dt-check.mjs`
Expected: обе команды PASS; проверить `git status --short` и удалить только созданные проверками ненужные артефакты.
