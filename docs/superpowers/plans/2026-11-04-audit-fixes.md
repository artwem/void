# Audit Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Устранить четыре подтверждённые ошибки аудита, не меняя пользовательские сценарии и архитектуру приложения.

**Architecture:** Изменения остаются в текущих файлах: безопасный хелпер JS-аргументов и восстановление/merge в `index.html`, изоляция кеша в `sw.js`, кроссплатформенные пути в `tools/shots.mjs`. Регрессионные проверки добавляются в существующий `tools/dt-check.mjs`; новых runtime-зависимостей и сборки нет.

**Tech Stack:** Vanilla JavaScript, HTML, Service Worker API, Node.js, Puppeteer.

**Spec:** `docs/superpowers/specs/2026-11-04-audit-fixes-design.md`

## Global Constraints

- Не менять стиль приложения: один глобальный JS-контекст в `index.html`, существующие `innerHTML` и inline-обработчики.
- Не добавлять зависимости, отдельные JS-файлы клиента или сборщик.
- Сохранять device-local URL/токен синхронизации, уведомления, тему и приватность при восстановлении.
- Все обычные синхронизации сохраняют порядок pull → merge → push; восстановление Drive-копии остаётся исключением с force-push.
- Не бампать версии приложения/SW и не выполнять commit/push без отдельной просьбы пользователя.

## Review Focus

- ID с кавычками, обратным слэшем, `<`, `>` и HTML-сущностями: обработчик получает исходную строку без выполнения кода — проверка Task 1.
- Старая копия без новых коллекций: восстановление очищает текущие записи этих коллекций — проверка Task 2.
- Авторитетная копия удаляет месяц/бронь: другое устройство принимает удаление, если у него нет несинхронизированной локальной правки — проверка Task 2.
- Два PWA на одном origin: активация V.O.I.D. не удаляет чужой кеш — проверка Task 3.
- POSIX-путь с пробелами и Windows-путь: формирование имени файла не обрезает начальный `/` и не использует ручную нормализацию — проверка Task 4 запуском штатного скрипта на macOS и чтением `fileURLToPath`.

---

### Task 1: Безопасные строковые аргументы в inline-обработчиках

**Files:**
- Modify: `index.html:1929-1935` и все найденные обработчики записей/копий с динамическими строковыми аргументами.
- Test: `tools/dt-check.mjs`, новая сюита рядом с проверками восстановления и deep links.

**Interfaces:**
- Produces: `jsArg(value) → string`, возвращающая JS string literal, экранированный для HTML-атрибута через `esc()`.
- Consumes: существующие `esc()`, CRUD-функции записей и `_renderBackupList(items)`.

- [ ] **Step 1: Написать падающие регрессионные проверки**

Добавить сюиту `безопасность динамических аргументов`:
- расход с `id = "x');window.__auditXss=1;//"` и комментарием `review-xss`: после открытия поиска и клика по редактированию `window.__auditXss` отсутствует, модалка открыта, сумма принадлежит этой записи;
- Drive-копия с таким же ID: заменить `restoreDriveBackup` заглушкой, кликнуть кнопку и проверить, что заглушка получила точный исходный ID без побочного выполнения;
- ID с `\\`, `<`, `>`, `&`, одинарной и двойной кавычками: `jsArg()` возвращает значение, которое после HTML-декодирования является одним корректным JS string literal.

- [ ] **Step 2: Запустить проверку и убедиться в исходном сбое**

Run: `CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node tools/dt-check.mjs`
Expected: новые проверки FAIL; на текущем коде `window.__auditXss === 1`.

- [ ] **Step 3: Реализовать и применить `jsArg(value)`**

Добавить `jsArg` рядом с `esc()`: `esc(JSON.stringify(String(value ?? '')))`. Заменить интерполяции вида `'${e.id}'`, `'${esc(d.id)}'` и динамических дат на `${jsArg(...)}` без дополнительных одинарных кавычек. Охватить расходы, доходы, шаблоны, вклады, инвестиции, кредиты и Drive-копии; фиксированные callback-имена и числовые индексы не трогать.

- [ ] **Step 4: Проверить безопасность и отсутствие регрессий**

Run: `CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node tools/dt-check.mjs`
Expected: все проверки PASS, включая открытие записей с обычными ID.

### Task 2: Полное и авторитетное восстановление копии

**Files:**
- Modify: `index.html:9127-9153` (`_applyRestoredData`) и `index.html:11383-11408` (3-way merge `limits`/`specPlan`).
- Test: `tools/dt-check.mjs`, рядом с `копии на Drive: список, восстановление, force-push`.

**Interfaces:**
- Consumes: существующие `buildPayload()`, `touchList(name)`, `_canonJSON(value)`, `mergePullData(d)`.
- Produces: восстановление полного снимка; merge по union ключей для `limits` и `specPlan` без изменения внешних сигнатур.

- [ ] **Step 1: Написать падающие проверки восстановления**

Добавить проверки:
- текущие `deposits`, `investments`, `credits` и `templates` заполнены, копия этих полей не содержит: после `_applyRestoredData(copy, true)` все они пусты, а локальные настройки сохранены;
- копия содержит собственные `specPlan`, `catOblig` и `oneoffThreshold`: после последующего `mergePullData()` со старыми удалёнными метками остаются значения копии;
- у удалённого снимка отсутствует ключ месяца/брони из baseline: merge удаляет локальный неизменённый ключ; если локальное значение отличается от baseline, оно сохраняется;
- объекты с одинаковым содержимым, но разным порядком ключей не считаются изменёнными.

- [ ] **Step 2: Запустить проверки и подтвердить исходные сбои**

Run: `CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node tools/dt-check.mjs`
Expected: новые проверки FAIL: текущие коллекции остаются, старые удалённые настройки выигрывают, удалённые remote-ключи не обрабатываются.

- [ ] **Step 3: Исправить применение снимка и 3-way merge**

В `_applyRestoredData` явно назначать все синхронизируемые коллекции/справочники из снимка с пустыми значениями по умолчанию, затем восстанавливать device-local поля. При `makeAuthoritative` штамповать записи, вызывать `touchList()` также для `catOblig` и `oneoffThreshold`, сбрасывать оба baseline.

В merge для `limits` и `specPlan` обходить union локальных и удалённых ключей. Удалённое значение применять/удалять только когда локальный ключ не отличается от baseline; локальные несинхронизированные правки сохранять. Не менять LWW записей и списков.

- [ ] **Step 4: Прогнать полный набор**

Run: `CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node tools/dt-check.mjs`
Expected: все проверки PASS, включая существующие sync/limits/specPlan и восстановление Drive.

### Task 3: Изоляция Cache Storage service worker

**Files:**
- Modify: `sw.js:28-36`.
- Test: `tools/dt-check.mjs`, новая сюита рядом с PWA/SW-проверками.

**Interfaces:**
- Consumes: текущие `CACHE = 'app-' + V` и событие `activate`.
- Produces: удаление только устаревших кешей `app-*`.

- [ ] **Step 1: Написать падающий поведенческий тест**

В браузере получить текст `sw.js`, выполнить его с моками `self`, `caches`, `location`; зарегистрировать обработчик `activate` и вызвать с кешами `app-old`, текущим `CACHE` и `foreign-app`. Проверить, что удалён только `app-old`.

- [ ] **Step 2: Подтвердить исходный сбой**

Run: `CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node tools/dt-check.mjs`
Expected: новая проверка FAIL, потому что `foreign-app` удаляется.

- [ ] **Step 3: Ограничить удаление собственным префиксом**

В фильтре активации оставить только `k.startsWith('app-') && k !== CACHE`. Не менять стратегии network-first/cache-first и безопасную перезагрузку.

- [ ] **Step 4: Проверить SW и офлайн**

Run: полный `dt-check`, затем реальная навигация с зарегистрированным SW и `page.setOfflineMode(true)`.
Expected: тесты PASS; офлайн-страница загружается без `pageerror`.

### Task 4: Кроссплатформенные пути скриншотов и финальная проверка

**Files:**
- Modify: `tools/shots.mjs:5-6,24-26,43-45`.
- Verify: штатный `tools/shots.mjs`; код приложения больше не менять.

**Interfaces:**
- Consumes: Node.js `url.fileURLToPath` и существующий `OUT = new URL('shots/', import.meta.url)`.
- Produces: абсолютные пути PNG на macOS/Linux и Windows.

- [ ] **Step 1: Зафиксировать исходный сбой**

Run: `CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node tools/shots.mjs`
Expected на исходном коде: `ENOENT` с относительным путём `Users/.../tools/shots/...` на macOS. Уже воспроизведено при аудите.

- [ ] **Step 2: Заменить ручное преобразование URL**

Импортировать `fileURLToPath` из `node:url`; оба `path:` получают `fileURLToPath(new URL(filename, OUT))` без `.slice(1)`.

- [ ] **Step 3: Запустить штатные скриншоты**

Run: `CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node tools/shots.mjs`
Expected: десять страниц на пяти ширинах и модалки на трёх ширинах создаются, завершается `готово`. Проверить представительные PNG, затем удалить созданные `tools/shots/` как временный результат проверки.

- [ ] **Step 4: Финальная проверка deliverable**

Run: синтаксическая проверка всех inline-скриптов, полный `dt-check`, `git status --short --branch`.
Expected: `syntax OK`; все тесты PASS; в git остаются только четыре целевых исходных файла и два документа спеки/плана, без временных изображений и логов.
