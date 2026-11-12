# Telegram Mini App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Запустить полный V.O.I.D. как личный Telegram Mini App, сохранив браузерную PWA, локальные данные и Drive-синхронизацию без изменений.

**Architecture:** Официальный Telegram SDK хранится локально и подключается в `index.html`; небольшая секция `telegram.js` адаптирует жизненный цикл, тему и safe area через защищённые глобальные хелперы. Общие HTML, CSS, `DB`, финансовые функции и `syncCycle()` остаются едиными для всех сред.

**Tech Stack:** Vanilla JavaScript, HTML, CSS, Telegram WebApp JS SDK, Puppeteer Core, существующий `tools/dt-check.mjs`.

**Spec:** `docs/superpowers/specs/2026-11-12-telegram-mini-app-design.md`

## Global Constraints

- `index.html` — единственный источник разметки и прикладного JS; отдельный прикладной `js/`-файл, npm-зависимость и сборщик не добавлять.
- Telegram SDK находится в `vendor/telegram-web-app.js` и в `PRECACHE`; CDN при запуске не использовать.
- Реальная среда — `WebApp` с `platform !== 'unknown'`; вне Telegram адаптер не производит вызовов и не меняет геометрию.
- Не менять `budgetDB_v2`, `buildPayload()`, Apps Script и порядок pull → merge → push.
- Не добавлять bot backend, HTML-виджеты, `initData`-авторизацию, DeviceStorage, BackButton/MainButton и startapp-команды.
- Пользовательские строки и финансовая логика не затрагиваются; явные темы V.O.I.D. имеют приоритет над Telegram.
- Версия результата — `v1.89.0`, Apps Script остаётся `10.5`.
- Не выполнять commit/push и не менять существующий `.claude/settings.local.json` без отдельной просьбы пользователя.
- Реальный Telegram WebView на iOS/Android проверяется после публикации; mock-тесты не считать такой проверкой.

## Review Focus

- SDK загружен, но обычный браузер имеет `platform === 'unknown'`: ожидается полностью прежний запуск; проверка в Task 1.
- Повторный вызов инициализации или старый Telegram без части методов: ожидается отсутствие дублей и исключений; проверки в Tasks 1–3.
- Смена Telegram dark/light при явной теме `sepia`: ожидается сохранение `sepia`; проверка в Task 2.
- Отсутствующие/нулевые `contentSafeAreaInset`: ожидаются нулевые Telegram-переменные и прежние системные отступы; проверка в Task 3.
- Первый запуск Telegram с пустой локальной базой: ожидается обычный `syncCycle()` без нового push и без автоматической миграции; существующие sync-проверки и полный прогон в Task 4.

---

### Task 1: Локальный SDK и жизненный цикл Mini App

**Files:**
- Create: `vendor/telegram-web-app.js`
- Modify: `index.html:17-53`, `index.html:11366-11680`
- Modify: `sw.js:9-17`
- Test: `tools/dt-check.mjs` перед блоком `// ─── РАННЕР`

**Interfaces:**
- Produces: `_tgWebApp(): WebApp|null` — возвращает SDK только при реальной Telegram-платформе.
- Produces: `_telegramInit(): void` — идемпотентно вызывает `expand()` и позже подключает события.
- Produces: `_telegramReady(): void` — безопасно вызывает `ready()` после первого рендера.
- Consumes: существующие `init()` и локальный `window.Telegram.WebApp`.

- [ ] **Step 1: Добавить failing-проверки определения среды и вызовов**

Добавить две отдельные `suite(390, ...)`, чтобы каждая получила свежую страницу:

```js
check('platform unknown не включает Telegram', async p => {
  const got = await p.evaluate(() => ({
    detected: _tgWebApp() !== null,
    init: _telegramInit(),
    vars: document.documentElement.style.getPropertyValue('--tg-content-top'),
  }));
  eq(got.detected, false, 'обычный браузер');
  eq(got.vars, '', 'Telegram inset не установлен');
});

check('expand и ready вызываются, init не дублируется', async p => {
  const got = await p.evaluate(() => {
    const calls = [];
    window.Telegram = { WebApp: {
      platform: 'ios',
      expand(){ calls.push('expand'); },
      ready(){ calls.push('ready'); },
    } };
    _telegramInit(); _telegramInit(); _telegramReady();
    return { detected: _tgWebApp() !== null, calls };
  });
  eq(got.detected, true, 'Telegram ios');
  eq(got.calls.join(','), 'expand,ready', 'вызовы SDK');
});
```

- [ ] **Step 2: Запустить проверки и убедиться в ожидаемом FAIL**

Run: `node tools/dt-check.mjs`
Expected: новые проверки FAIL с `ReferenceError: _tgWebApp is not defined`; существующие результаты не используются как оправдание новых ошибок.

- [ ] **Step 3: Подключить официальный SDK локально**

Загрузить документированный Telegram SDK без добавления пакета:

```bash
curl -fsSL 'https://telegram.org/js/telegram-web-app.js?65' -o vendor/telegram-web-app.js
node --check vendor/telegram-web-app.js
```

Подключить `<script src="vendor/telegram-web-app.js"></script>` в `<head>` перед текущими inline- и vendor-скриптами. Добавить `'./vendor/telegram-web-app.js'` в `PRECACHE`.

- [ ] **Step 4: Реализовать секцию `telegram.js` и подключить её to `init()`**

Добавить `// ═══ telegram.js ═══` перед `init.js`. `_tgWebApp()` каждый раз читает текущий `window.Telegram`, чтобы mock и реальный SDK использовали один путь. `_telegramInit()` имеет отдельный guard от повторов, вызывает `expand()` в try/catch и пока не добавляет тему/insets. `_telegramReady()` безопасно вызывает `ready()`.

В `init()` вызвать `_telegramInit()` до загрузки/рендера, а `_telegramReady()` — после `renderDay()` и базовой инициализации. Ошибка Telegram API не должна прерывать приложение.

- [ ] **Step 5: Запустить полный автоматический прогон**

Run: `node tools/dt-check.mjs`
Expected: все проверки PASS, включая обе Telegram-проверки.

---

### Task 2: Тема Telegram и цвета нативной оболочки

**Files:**
- Modify: `index.html:17-30` — ранняя тема в `<head>`
- Modify: `index.html:4012-4030` — `applyTheme()`
- Modify: `index.html` — секция `telegram.js` из Task 1
- Test: `tools/dt-check.mjs`

**Interfaces:**
- Consumes: `_tgWebApp()`, `_telegramInit()` из Task 1.
- Produces: `_telegramHex(color: string): string|null` — нормализует `#rgb`, `#rrggbb`, `rgb(r, g, b)` в `#rrggbb`, неизвестное значение отклоняет.
- Produces: `_telegramSyncChrome(background: string): void` — окрашивает header/background в фон body и bottom bar в `var(--card)` при поддержке.
- Uses: `WebApp.onEvent('themeChanged', handler)`; handler повторно применяет тему и перерисовывает текущую страницу только при `DB.theme === 'auto'` или отсутствующей теме.

- [ ] **Step 1: Добавить failing-проверку auto/explicit тем и цветов**

В свежей Telegram-сюите установить mock с `platform:'ios'`, `colorScheme:'dark'`, `isVersionAtLeast:v => true`, методами `setHeaderColor`, `setBackgroundColor`, `setBottomBarColor`, `expand`, `onEvent`; сохранить обработчики и цвета в объекте mock.

Assertions после `_telegramInit(); DB.theme='auto'; applyTheme()` и ожидания `requestAnimationFrame`:

```js
eq(root.classList.contains('dark'), true, 'auto + Telegram dark');
eq(calls.header, '#141412', 'header = --bg');
eq(calls.background, '#141412', 'background = --bg');
eq(calls.bottom, '#1e1e1c', 'bottom = --card');
```

Изменить `colorScheme='light'`, вызвать сохранённый `themeChanged`: ожидается `light`. Затем задать `DB.theme='sepia'`, `applyTheme()`, сменить `colorScheme='dark'` и снова вызвать событие: ожидается `sepia`, `header === '#f0e6d2'`, `bottom === '#faf3e0'`.

Отдельно проверить `_telegramHex('rgb(26, 95, 168)') === '#1a5fa8'`, `_telegramHex('transparent') === null`; mock без `setBottomBarColor` и с `isVersionAtLeast:v => false` не должен бросать исключение. Два `_telegramInit()` должны дать ровно одну подписку `themeChanged`.

- [ ] **Step 2: Запустить проверку и убедиться в FAIL**

Run: `node tools/dt-check.mjs`
Expected: FAIL из-за отсутствующих `_telegramHex`/цветовых вызовов и неверного auto-theme поведения.

- [ ] **Step 3: Реализовать Telegram-aware тему**

В раннем `<head>` после чтения сохранённой темы: если она `auto`/отсутствует и SDK сообщает реальную платформу, добавить `light` или `dark` по `colorScheme`; явную тему не трогать.

В `applyTheme()` при `auto` в Telegram явно ставить класс по `colorScheme`; вне Telegram сохранить текущий CSS `@media`-путь. В существующем `requestAnimationFrame` после обновления meta theme-color вызвать `_telegramSyncChrome(bg)`.

В `_telegramInit()` однократно подписаться на `themeChanged`: вызвать `applyTheme()` и при auto — `renderCurrentPage()`. Реализовать `_telegramHex()` и `_telegramSyncChrome()`; bottom bar вызывать только при наличии метода и `isVersionAtLeast('7.10')`.

- [ ] **Step 4: Запустить проверки**

Run: `node tools/dt-check.mjs`
Expected: все проверки PASS.

---

### Task 3: Safe area без изменения обычной PWA

**Files:**
- Modify: `index.html` — секция `telegram.js`
- Modify: `css/app.css:15-50`, `css/app.css:189-198`, `css/app.css:228`, `css/app.css:436-439`
- Test: `tools/dt-check.mjs`

**Interfaces:**
- Consumes: `_telegramInit()` из Tasks 1–2.
- Produces: `_telegramApplyInsets(): void` — читает `contentSafeAreaInset`, нормализует отсутствующие/отрицательные значения к нулю и записывает `--tg-content-top|right|bottom|left` в px.
- Uses: `WebApp.onEvent('safeAreaChanged'|'contentSafeAreaChanged', _telegramApplyInsets)`.
- CSS: `--safe-bottom: max(env(safe-area-inset-bottom), var(--tg-content-bottom, 0px))`; все Telegram-переменные по умолчанию равны `0px`.

- [ ] **Step 1: Добавить failing-проверку inset и обновления по событию**

В свежей сюите mock имеет `contentSafeAreaInset:{top:44,right:0,bottom:34,left:0}`, `onEvent`, `expand`, `isVersionAtLeast:v => false`. После `_telegramInit()` проверить:

```js
eq(root.style.getPropertyValue('--tg-content-top'), '44px', 'top inset');
eq(await cssOf(p, 'body', 'paddingTop'), '44px', 'начальный верхний отступ');
eq(await cssOf(p, '.day-hdr', 'top'), '44px', 'липкая шапка');
eq(await cssOf(p, 'nav.nav', 'paddingBottom'), '34px', 'нижняя навигация');
eq(await cssOf(p, '.sheet', 'paddingBottom'), '34px', 'sheet');
```

Изменить inset на `{top:0,bottom:0}`, вызвать оба сохранённых safe-area события: ожидаются `body.paddingTop === '0px'`, `nav.paddingBottom === '20px'`, `.day-hdr.top === '0px'`. Отдельный mock без `contentSafeAreaInset` и без `onEvent` не должен бросать исключение; два init не дублируют подписки.

- [ ] **Step 2: Запустить проверку и убедиться в FAIL**

Run: `node tools/dt-check.mjs`
Expected: FAIL из-за отсутствующих CSS-переменных и inset-стилей.

- [ ] **Step 3: Реализовать переменные и обработчики**

`_telegramApplyInsets()` вызывается из `_telegramInit()` до `ready()` и по обоим событиям. Подписки добавляются только при наличии `onEvent` и общим guard идемпотентности.

В `:root` определить Telegram-переменные и `--safe-bottom`. Добавить body `padding-top:var(--tg-content-top,0px)`; `.hdr,.day-hdr` получают этот же `top`; `.overlay` получает верхний padding для защиты содержимого. Заменить существующие нижние `env(safe-area-inset-bottom)` на `var(--safe-bottom)` в body, nav, FAB, sheet и обоих `.page-end`, не добавляя второй аналогичный отступ.

- [ ] **Step 4: Запустить проверки и подтвердить прежнюю геометрию**

Run: `node tools/dt-check.mjs`
Expected: все проверки PASS; существующие мобильные размеры, навбар, sheets и десктопные suites остаются зелёными.

---

### Task 4: Документация, версия и полная проверка deliverable

**Files:**
- Modify: `README.md` — новый раздел между PWA и Drive sync
- Modify: `AGENTS.md` — обзор, технологии/ресурсы и таблица секций
- Modify: `index.html:33`, `index.html:1441`
- Modify: `sw.js:5`
- Verify: все изменённые файлы

**Interfaces:**
- Consumes: рабочий адаптер из Tasks 1–3.
- Produces: пользовательскую инструкцию Main Mini App и релиз `v1.89.0`; новых runtime-интерфейсов нет.

- [ ] **Step 1: Обновить документацию и версии**

README: создание бота через `@BotFather` → Bot Settings → Configure Mini App → Enable Mini App, URL `https://artwem.github.io/void/`. Отдельно предупредить о пустом отдельном localStorage и необходимости повторно ввести Apps Script URL/token; токен бота не помещать в проект.

`AGENTS.md`: указать Telegram Mini App, локальный `vendor/telegram-web-app.js` и секцию `telegram.js` с назначением. Видимая версия — `v1.89.0`; `const V = '2026-11-12 v1.89.0'`; stylesheet query — `?v=1.89.0`.

- [ ] **Step 2: Проверить синтаксис всех inline scripts**

Run: `node -e "const html=require('fs').readFileSync('index.html','utf8');const re=/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g;let m,ok=true;while((m=re.exec(html))){try{new Function(m[1])}catch(e){ok=false;console.log('FAIL:',e.message)}};console.log(ok?'syntax OK':'ERRORS')"`
Expected: `syntax OK`.

- [ ] **Step 3: Прогнать полный набор поведенческих проверок**

Run: `node tools/dt-check.mjs`
Expected: `N из N прошло`, exit code 0; включая существующие sync/deep-link suites и новые Telegram suites.

- [ ] **Step 4: Проверить визуальный deliverable**

Run: `node tools/shots.mjs`
Expected: завершение без ошибок; просмотреть мобильные страницы/модалки и представительные десктопные shots. Вне Telegram safe-area переменные нулевые, визуальных регрессий нет. Не коммитить `tools/shots/`; удалить только новые созданные этим прогоном артефакты, не трогая ранее существовавшие файлы.

- [ ] **Step 5: Проверить итоговый diff и перечислить ручную приёмку**

Run: `git status --short && git diff --check`
Expected: только предусмотренные файлы плюс ранее существовавший `.claude/settings.local.json`; whitespace-ошибок нет.

В финальном отчёте отдельно оставить непроверенное на реальных клиентах: BotFather/Main Mini App, iOS/Android, клавиатура, нативные inset/theme, реальный перенос тестовой траты Telegram ↔ PWA через Apps Script после публикации. Не объявлять эти пункты выполненными без фактической проверки.
