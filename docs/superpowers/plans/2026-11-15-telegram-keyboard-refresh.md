# Telegram Keyboard Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Не отправлять «Выберите шаблон» после каждого расхода; обновлять клавиатуру Telegram только при изменении состава шаблонов.

**Architecture:** В Script Properties хранится подпись активных шаблонов. Она обновляется после успешной отправки клавиатуры; `_telegramAddTemplate()` отправляет клавиатуру только при различии подписи, а подтверждение расхода — независимо.

**Tech Stack:** Google Apps Script, Telegram Bot API, Node.js `vm` + `assert/strict`, существующие `tools/gs-check.mjs` и `tools/dt-check.mjs`.

**Spec:** `docs/superpowers/specs/2026-11-15-telegram-keyboard-refresh-design.md`

## Global Constraints

- Обычный ответ — только подтверждение расхода и inline «Отменить»; отдельная клавиатура — лишь при изменении шаблонов.
- Подпись учитывает все влияющие на запись поля и порядок; удалённые шаблоны исключены.
- Подпись сохраняется только после успешной отправки клавиатуры; сбой не мешает повторной доставке и не дублирует расход.
- Не менять финансовую логику, undo, идемпотентность, Drive merge и `getUpdates`.
- Клиент — `v1.91.1`, Apps Script — `11.2`, новая версия service worker для сброса кеша.

## Review Focus

- Повторный update при уже доставленной клавиатуре: не должно быть второго сообщения или расхода; проверка в Task 1.
- Сбой именно отправки клавиатуры: подпись не сохраняется, подтверждение можно повторно доставить без повторной записи; проверка в Task 1.
- Изменение не только суммы, но и категории, комментария, разовости, порядка и удаления: подпись должна измениться; проверки в Task 1.
- Реальный Telegram UI: после двух одинаковых расходов не должно быть повторного «Выберите шаблон»; ручная приёмка в Task 1.
- Старые operation-записи с `notifications.keyboard`: переход на подпись не должен сломать повторную доставку; проверка совместимости в Task 1.

---

### Task 1: Подпись клавиатуры и обновление только при изменениях

**Files:**
- Modify: `apps-script/Code.gs` — подпись и сообщения шаблонов
- Modify: `tools/gs-check.mjs`
- Modify: `tools/dt-check.mjs` — версия `11.2` в существующих ожиданиях
- Modify: `index.html` — `APPS_SCRIPT_VERSION` и About
- Modify: `sw.js` — `const V`
- Modify: `README.md` — поведение обновления клавиатуры
- Modify: `AGENTS.md` — версии и инвариант подписи
- Create: `docs/superpowers/specs/2026-11-15-telegram-keyboard-refresh-design.md` и этот план (уже существуют и включаются в коммит)

**Interfaces:**
- Produces `_telegramKeyboardSignature(db): string` — детерминированная подпись активных шаблонов с учётом полей записи и порядка.
- Produces `_telegramRememberKeyboard(db): void` — сохраняет текущую подпись после уже успешно отправленной клавиатуры.
- Consumes: существующие `_telegramKeyboard`, `_telegramHandleMessage`, `_telegramAddTemplate` и operation/dedupe records.

- [ ] **Step 1: Добавить failing-проверки подписи и сообщений**

Проверить подпись: две активные записи с разными `catId`, `comment`, `oneoff`, `special`, суммой и порядком дают различия; `_deleted` не меняет результат. Проверить, что `_telegramRememberKeyboard(db)` вызывается после `/start` и сохраняет ровно `_telegramKeyboardSignature(db)`.

Изменить существующий тест записи: сначала вызвать `_telegramRememberKeyboard(db)` и очистить `calls.urlFetch`, затем добавить расход. Ожидается **одно** `sendMessage` — только подтверждение с `undo:<id>`. Повторный update с новым `message_id` снова не должен вызывать сообщение клавиатуры.

Добавить сценарии:
- после изменения `amount` приходят обновлённая клавиатура и подтверждение, подпись изменилась;
- после ошибки `sendMessage` для клавиатуры подпись не изменилась, повторный update не создал второй расход и недоставленные сообщения можно повторить;
- старая operation с `notifications.keyboard:false` не вызывает клавиатуру, если подпись актуальна.

- [ ] **Step 2: Запустить и увидеть ожидаемый FAIL**

Run: `node tools/gs-check.mjs`
Expected: новые проверки FAIL из-за отсутствующих `_telegramKeyboardSignature`/`_telegramRememberKeyboard` и лишнего сообщения `Выберите шаблон` после расхода.

- [ ] **Step 3: Реализовать подпись и условную отправку**

`_telegramKeyboardSignature` сериализует активные шаблоны в текущем порядке с полями `id,name,cat,catId,amount,comment,oneoff,special`, без `_deleted`.

`_telegramRememberKeyboard` записывает подпись в `TELEGRAM_KEYBOARD_SIGNATURE`. Вызывать её после успешной отправки `/start`, навигации, подсказки и обновлённой клавиатуры, но не при ошибке Bot API.

В `_telegramAddTemplate` заменить принудительную ветку `notifications.keyboard` на сравнение подписи: при различии отправить `Шаблоны обновлены:` с `_telegramKeyboard(db,0)` и только после успеха сохранить новую подпись. Подтверждение расхода не изменять; существующие operation-записи и `notifications.confirmation` сохранить для повторной доставки.

- [ ] **Step 4: Запустить полные проверки**

Run: `node tools/gs-check.mjs && CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node tools/dt-check.mjs`
Expected: новые и прежние проверки PASS.

- [ ] **Step 5: Обновить документацию и версии**

`VERSION='11.2'`, `APPS_SCRIPT_VERSION='11.2'`, About `v1.91.1`, `const V='2026-11-15 v1.91.1'`. В существующих version-sensitive проверках `dt-check` обновить только `11.1` → `11.2`.

README: после расхода обычно только подтверждение, клавиатура обновляется при изменении шаблонов. AGENTS: те же версии и инвариант подписи `TELEGRAM_KEYBOARD_SIGNATURE`.

Повторить Step 2 синтаксиса Apps Script и Step 4 всех проверок, затем `git diff --check`.

- [ ] **Step 6: Commit и реальная приёмка**

```bash
git add apps-script/Code.gs tools/gs-check.mjs tools/dt-check.mjs index.html sw.js README.md AGENTS.md docs/superpowers/specs/2026-11-15-telegram-keyboard-refresh-design.md docs/superpowers/plans/2026-11-15-telegram-keyboard-refresh.md
git commit -m "fix: refresh Telegram keyboard only on changes"
```

После обновления Apps Script добавить два одинаковых расхода: должно быть только подтверждение с «Отменить», без повторного «Выберите шаблон». Изменить сумму шаблона в приложении, дождаться Drive sync и проверить одно сообщение обновления клавиатуры. Тестовые расходы отменить.
