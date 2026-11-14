# Telegram Expense Bot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавлять расходы из постоянной клавиатуры `@voiddmv_bot` одним нажатием на существующий шаблон, с отменой и безопасной синхронизацией через Drive.

**Architecture:** Существующий Apps Script принимает Telegram webhook рядом с прежним pull/push API. Постоянная `ReplyKeyboardMarkup` строится из шаблонов последней Drive-версии; расходы пишутся под `LockService` с меткой `source:'telegram'`, узким server-side merge при клиентском push и идемпотентной обработкой доставок Telegram.

**Tech Stack:** Google Apps Script, Telegram Bot API, Drive, Node.js `vm` + `assert/strict` для dev-only проверок, существующий Puppeteer Core runner.

**Spec:** `docs/superpowers/specs/2026-11-12-telegram-expense-bot-design.md`

## Global Constraints

- Постоянная клавиатура без `/add`; `/start` нужен только один раз для первого ответа бота.
- Один тап сразу сохраняет расход; после успешной записи есть inline-кнопка «Отменить».
- Только личный чат и `TELEGRAM_ALLOWED_USER_ID`; токены задаются в Script Properties и не попадают в репозиторий, логи или фикстуры.
- Не менять `budgetDB_v2`, `buildPayload()`, клиентский порядок pull → merge → push и прежние действия Apps Script API.
- Новый backend, сервер и npm-зависимости не добавлять; реальных финансовых данных в тестах нет.
- Запись бота соответствует `addFromTemplate()` и дополнительно имеет `source:'telegram'`; отмена — `_deleted:true`, `amount:0`, новый `updatedAt`.
- Не-force push объединяет только bot-записи по `id`/`updatedAt`; force-restore сохраняет полную замену без подмешивания.
- Apps Script — `11.0`, видимая версия — `v1.90.0`; часовой пояс Apps Script — `Europe/Moscow`.
- Реальные Telegram/Drive проверяются после публикации; mock-проверки не считать такой приёмкой.

## Review Focus

- Реальный Apps Script event может отличаться от mock по `parameter`, `postData` и Script Properties: webhook должен пропускать только секретный запрос; ручная проверка в Task 4.
- Длинные названия, копейки и 10+ шаблонов на реальном Telegram: клавиатура должна оставаться читаемой, навигация не создаёт расход; unit-проверки в Task 1 и ручная — в Task 4.
- Повторная доставка webhook после таймаута: ни сообщение, ни callback не должны дать дубль; проверки в Tasks 2–3, реальная приёмка в Task 4.
- Запись бота около полуночи: дата должна быть московской, не UTC; unit-проверка в Task 2 и ручная проверка часового пояса в Task 4.
- Старый клиент делает push после записи/отмены бота: запись или tombstone не исчезает, force-restore не воскрешает старое; проверки в Task 3.

---

### Task 1: Dev-only Apps Script runner, клавиатура и доступ

**Files:**
- Create: `tools/gs-check.mjs`
- Modify: `apps-script/Code.gs:18-41`
- Modify: `tools/package.json:6`

**Interfaces:**
- Produces test helper `loadGs(options): {context, state, calls}` — выполняет `Code.gs` в новом Node `vm` с in-memory Drive, Cache, Properties и записями UrlFetch; реальной сети нет.
- Produces `_telegramTemplateLabel(template): string` — `name + ' — ' + amount + ' ₽'`, копейки через запятую.
- Produces `_telegramKeyboard(db, page): ReplyKeyboardMarkup` — активные шаблоны по две кнопки, 10 на страницу, `Ещё N/M` и `Назад N/M`.
- Produces `_telegramAllowed(from, chat): boolean` — только разрешённый пользователь в личном чате.
- Produces `_telegramHandleMessage(message): void` — `/start`, смена страниц и подсказка; запись шаблонов появится в Task 2.

- [ ] **Step 1: Создать failing runner и проверки клавиатуры/доступа**

`tools/gs-check.mjs` загружает `apps-script/Code.gs` через `readFileSync` и `vm.createContext` отдельно для каждой проверки. Stub `ContentService` возвращает объект с `getData()` и `getMimeType()`; `out()` можно разбирать как JSON. В `loadGs` заданы только тестовые `test-token`, `test-secret`, пользователь `42` и сериализуемый in-memory DB.

Добавить проверки с явными значениями:

```js
const db = { templates: [
  { id:'t1', name:'Кофе', amount:350, cat:1, catId:'c1' },
  { id:'t2', name:'Такси', amount:12.5, cat:2, catId:'c2' },
  { id:'t3', name:'Удалён', amount:999, _deleted:true },
] };
eq(context._telegramTemplateLabel(db.templates[0]), 'Кофе — 350 ₽');
eq(context._telegramTemplateLabel(db.templates[1]), 'Такси — 12,50 ₽');
eq(context._telegramKeyboard(db, 0).keyboard.flat().map(b => b.text).join('|'), 'Кофе — 350 ₽|Такси — 12,50 ₽');
```

Отдельно: 11 шаблонов дают `Ещё 2/2` на странице 0 и `Назад 1/2` на странице 1; смена страницы через `_telegramHandleMessage` отправляет клавиатуру и оставляет `state.db.expenses` пустым. `/start` вызывает `sendMessage` с `resize_keyboard:true`, `is_persistent:true`, `one_time_keyboard:false`.

Проверить, что чужой `from.id`, групповой чат и неверный `?telegram=` не вызывают Drive/UrlFetch и не возвращают шаблоны.

- [ ] **Step 2: Запустить и увидеть ожидаемый FAIL**

Run: `node tools/gs-check.mjs`
Expected: FAIL из-за отсутствующих `_telegramTemplateLabel` и `_telegramKeyboard`; существующие sync-проверки не используются как оправдание.

- [ ] **Step 3: Реализовать защищённую Telegram-ветку и клавиатуру**

В `doPost(e)` сначала разобрать JSON; Telegram webhook распознаётся по `message`/`callback_query` и проверяет `e.parameter.telegram` до Drive. Прежние `action`-запросы продолжают использовать `SECRET` без изменений.

Добавить `_telegramApi(method, payload)` поверх mocked `UrlFetchApp`, `_telegramTemplateLabel`, `_telegramKeyboard`, `_telegramAllowed` и `_telegramHandleMessage`. `/start`, `Ещё N/M`, `Назад N/M` и неизвестный текст только отправляют сообщения; запись по тексту шаблона пока возвращает «Скоро будет доступно» без изменения DB.

В `tools/package.json` сделать `check`: `node gs-check.mjs && node dt-check.mjs`.

- [ ] **Step 4: Запустить серверные и прежние проверки**

Run: `node tools/gs-check.mjs && CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node tools/dt-check.mjs`
Expected: новые проверки PASS; прежние `277 из 277 прошло`.

- [ ] **Step 5: Commit**

```bash
git add tools/gs-check.mjs tools/package.json apps-script/Code.gs
git commit -m "feat: add Telegram template keyboard"
```

---

### Task 2: Добавление расхода одним нажатием

**Files:**
- Modify: `apps-script/Code.gs` — Telegram-ветка и Drive-запись
- Test: `tools/gs-check.mjs`

**Interfaces:**
- Consumes: клавиатура и message handler из Task 1.
- Produces `_telegramExpenseFromTemplate(template, db, now): Expense` — запись с `source:'telegram'`.
- Produces `_telegramAddTemplate(message, template): Expense` — read-modify-write под `LockService`, подтверждение после записи.
- Produces ключ идемпотентности `message:<chat_id>:<message_id>`.

- [ ] **Step 1: Добавить failing-проверки записи и повторной доставки**

Фикстура: категории `['Еда','Такси']`, `catIds:['c1','c2']`, шаблон `{id:'t1',name:'Кофе',amount:12.5,cat:0,catId:'c1',comment:'Латте',oneoff:true}` и время `2026-11-12T21:30:00Z` с московской датой `2026-11-13`.

Проверить созданную запись:

```js
eq(rec.cat, 0); eq(rec.catId, 'c1'); eq(rec.amount, 12.5);
eq(rec.date, '2026-11-13'); eq(rec.comment, 'Кофе: Латте');
eq(rec.oneoff, true); eq(rec.source, 'telegram');
eq(typeof rec.id, 'string'); eq(rec.updatedAt > 0, true);
```

Одно `sendMessage` возвращает свежую постоянную клавиатуру, второе подтверждает запись и содержит `reply_markup.inline_keyboard` с `callback_data:'undo:'+rec.id`. Повтор того же `message_id` оставляет один расход и не шлёт второе подтверждение; новый `message_id` с той же кнопкой осознанно создаёт второй расход. Отдельно проверить `special:true` и отсутствие комментария.

Ошибка записи Drive не создаёт подтверждения успеха: пользователь получает просьбу повторить позже.

- [ ] **Step 2: Запустить и увидеть FAIL**

Run: `node tools/gs-check.mjs`
Expected: FAIL: текст шаблона не создаёт расход и отсутствует `_telegramExpenseFromTemplate`.

- [ ] **Step 3: Реализовать запись под lock и идемпотентность**

Добавить `_telegramExpenseFromTemplate` и `_telegramAddTemplate`; генерация ID использует `Utilities.getUuid()` без числового преобразования. Дата — `Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd')`.

Под общим `LockService` сначала проверить message key в `CacheService` и `PropertiesService`, затем прочитать последний DB, добавить запись, выполнить существующее `backupIfDue` и сохранить. Только после успешной записи пометить ключ обработанным: в Cache на 600 секунд и в Properties на 24 часа с последующей очисткой устаревших ключей. На ошибке done-маркера нет, поэтому повторная доставка может быть обработана. Не вызывать клиентский `syncCycle()` и не делать отдельный push из браузера.

После успеха одним сообщением отправить свежую клавиатуру, вторым — подтверждение с inline-кнопкой отмены: Telegram не позволяет совместить два типа markup в одном сообщении. При ошибке записи не показывать успех или кнопку отмены.

- [ ] **Step 4: Запустить проверки**

Run: `node tools/gs-check.mjs && CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node tools/dt-check.mjs`
Expected: все проверки PASS.

- [ ] **Step 5: Commit**

```bash
git add apps-script/Code.gs tools/gs-check.mjs
git commit -m "feat: save expenses from Telegram keyboard"
```

---

### Task 3: Отмена и защита bot-записей при гонках

**Files:**
- Modify: `apps-script/Code.gs:65-91` и Telegram-ветка
- Test: `tools/gs-check.mjs`

**Interfaces:**
- Consumes: `source:'telegram'`, `undo:<expenseId>` и CacheService/PropertiesService из Task 2.
- Produces `_telegramUndo(callbackQuery): void` — безопасная отмена только bot-записи.
- Produces `_mergeTelegramExpenses(currentDb, incomingDb): Object` — LWW только для `source:'telegram'`.
- Produces ключ идемпотентности `callback:<callback_query.id>`.

- [ ] **Step 1: Добавить failing-проверки отмены и LWW**

После создания расхода вызвать callback от разрешённого пользователя с `data:'undo:'+id`. Проверить `_deleted:true`, `amount:0`, новый `updatedAt`, `answerCallbackQuery` и обновлённое сообщение без inline-кнопки. Повтор того же callback не меняет `updatedAt`; чужой пользователь и попытка отменить обычную клиентскую запись не меняют DB.

Для merge использовать литеральные записи:

```js
// current: bot add updatedAt:100, bot tombstone updatedAt:200, обычная запись updatedAt:300
// incoming: только bot tombstone id:200 с updatedAt:150
eq(merged.expenses.filter(e => e.id === 'add100').length, 1, 'старый push не теряет bot add');
eq(merged.expenses.find(e => e.id === 'del200').updatedAt, 200, 'новая отмена бота побеждает');
eq(merged.expenses.find(e => e.id === 'client300').source, undefined, 'обычные записи не смешиваем');
```

Отдельно: входящий tombstone с `updatedAt:250` побеждает bot add `200`; `force=true` оставляет входящий payload без текущих bot-записей.

- [ ] **Step 2: Запустить и увидеть FAIL**

Run: `node tools/gs-check.mjs`
Expected: FAIL: undo не обрабатывается и старый `saveData` затирает bot-запись.

- [ ] **Step 3: Реализовать отмену и узкий server-side merge**

`_telegramUndo` проверяет секрет/пользователя/личный чат, ключ callback и `source:'telegram'`. Под lock обновляет tombstone, помечает callback обработанным на 600 секунд в Cache и 24 часа в Properties, отвечает на callback и редактирует подтверждение. Повтор и неавторизованные callbacks не имеют побочных эффектов.

`_mergeTelegramExpenses` копирует только bot-записи из текущей Drive-версии и сравнивает по `id`, затем `updatedAt`. `saveData(content, force)` вызывает merge только при `!force`; прежняя защита от подозрительно маленького push, backup и LockService сохраняются.

- [ ] **Step 4: Запустить проверки**

Run: `node tools/gs-check.mjs && CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node tools/dt-check.mjs`
Expected: все проверки PASS, включая force-restore и гонки.

- [ ] **Step 5: Commit**

```bash
git add apps-script/Code.gs tools/gs-check.mjs
git commit -m "feat: protect Telegram expense writes"
```

---

### Task 4: Webhook, документация, версии и приёмка

**Files:**
- Modify: `apps-script/Code.gs:1-17` и функции webhook
- Modify: `index.html:33,1442,10329`
- Modify: `sw.js:5`
- Modify: `README.md` — раздел Telegram Mini App
- Modify: `AGENTS.md` — обзор, Apps Script, тестирование и безопасность
- Verify: `tools/gs-check.mjs`, `tools/dt-check.mjs`

**Interfaces:**
- Produces `setupTelegramWebhook(): void` — `setWebhook` на текущий `/exec` с `?telegram=TELEGRAM_WEBHOOK_SECRET`.
- Produces `deleteTelegramWebhook(): void` — отключение webhook для отката.
- Consumes: Script Properties `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_USER_ID`, `TELEGRAM_WEBHOOK_SECRET`.

- [ ] **Step 1: Добавить failing-проверки setup и обновить документацию**

Проверить, что `setupTelegramWebhook()` вызывает именно `setWebhook` с URL `https://script.google.com/macros/s/test-exec/exec?telegram=test-secret`; token есть только в Bot API URL внутри mock и не выводится в возвращаемый результат/логи. `deleteTelegramWebhook()` вызывает `deleteWebhook`.

README: постоянные кнопки, одноразовый `/start`, обновление клавиатуры при следующем обращении, Script Properties, запуск setup вручную, Europe/Moscow и обязательное новое развёртывание `/exec`. AGENTS: Apps Script `11.0`, Telegram webhook, `source:'telegram'`, merge и `node tools/gs-check.mjs` в стандартной проверке.

- [ ] **Step 2: Запустить и увидеть FAIL**

Run: `node tools/gs-check.mjs`
Expected: FAIL из-за отсутствующих `setupTelegramWebhook`/`deleteTelegramWebhook`.

- [ ] **Step 3: Реализовать setup и поднять версии**

Добавить обе функции через `UrlFetchApp` и `ScriptApp.getService().getUrl()` без печати токена. `VERSION='11.0'`, `APPS_SCRIPT_VERSION='11.0'`, About `v1.90.0`, `const V='2026-11-14 v1.90.0'`, CSS `?v=1.90.0`.

- [ ] **Step 4: Проверить весь deliverable**

Run: `node --check < apps-script/Code.gs && node tools/gs-check.mjs`
Expected: синтаксис валиден, все server-проверки PASS.

Run: `node -e "const html=require('fs').readFileSync('index.html','utf8');const re=/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g;let m,ok=true;while((m=re.exec(html))){try{new Function(m[1])}catch(e){ok=false;console.log('FAIL:',e.message)}};console.log(ok?'syntax OK':'ERRORS')"`
Expected: `syntax OK`.

Run: `CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node tools/dt-check.mjs`
Expected: `277 из 277 прошло` или больше при добавленных client-проверках.

Run: `git status --short && git diff --check`
Expected: только предусмотренные файлы и ранее существовавшие `.DS_Store`; whitespace-ошибок нет.

- [ ] **Step 5: Commit**

```bash
git add apps-script/Code.gs index.html sw.js README.md AGENTS.md tools/gs-check.mjs tools/package.json docs/superpowers/specs/2026-11-12-telegram-expense-bot-design.md docs/superpowers/plans/2026-11-12-telegram-expense-bot.md
git commit -m "feat: complete Telegram expense bot"
```

- [ ] **Step 6: Ручная приёмка после публикации**

Обновить Apps Script до новой версии развёртывания, задать три Script Properties и Europe/Moscow, выполнить `setupTelegramWebhook` один раз. Проверить настоящий `/exec`, `/start`, постоянные кнопки, копейки, разовость, две записи подряд, отмену, обновление шаблонов, отказ постороннему аккаунту и pull в PWA/Mini App. Проверить push открытой PWA после bot-записи и после отмены. Тестовые расходы удалить; токены в отчёт не включать.
