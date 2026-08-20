# Десктопная оболочка V.O.I.D. — план реализации (часть 1: фундамент)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать приложению десктопную оболочку — сайдбар, липкую контекстную колонку месяца и инспектор вместо модалок — и вендоренную типографику, не сломав мобильную версию.

**Architecture:** Всё живёт в тех же `index.html` и `css/app.css`. Десктоп — это один блок `@media (min-width:1000px)`, который превращает `body` в грид и переставляет уже существующие узлы. Содержимое страниц и модалок не переписывается. Проверка — puppeteer-харнесс, который поднимает статический сервер, засевает localStorage фикстурой и проверяет геометрию через `getBoundingClientRect`.

**Tech Stack:** Vanilla JS, CSS Grid, puppeteer-core 23 + системный Chrome, `uv run --with fonttools` для разовой нарезки сабсетов.

**Spec:** `docs/superpowers/specs/2026-08-20-desktop-layout-design.md`

## Global Constraints

- Ниже 1000 px вёрстка не меняется нигде, кроме гарнитуры. Любая правка, задевающая мобильную раскладку, — дефект.
- `index.html` — единственный источник JS. Никаких новых `.js`-файлов в рантайме.
- Каталог `tools/` — только для разработки. Он не попадает в `PRECACHE` и не подключается из `index.html`.
- Расчёты не трогаются: `_monthForecast`, `_budgetFree`, `_buildAssetSeries`, `depositValueAt`, `mergePullData` остаются как есть.
- Цвета берутся только из существующих CSS-переменных (`--bg`, `--card`, `--border`, `--border2`, `--text`, `--muted`, `--hint`, `--red`, `--green`, `--amber`, `--blue`, `--accent`). Ни одного литерала — иначе отвалятся 10 тем.
- Все денежные значения в innerHTML идут через `fmtH()`, пользовательские строки — через `esc()`.
- Каждый деплой: версия в `index.html:1231`, `const V` в `sw.js`, `?v=` у `css/app.css` в `<link>`.
- Брейкпоинты ровно три: 1000, 1200, 1440.

---

### Task 1: Тест-харнесс

Без него все последующие задачи проверяются глазами на пяти ширинах — это неповторяемо. Харнесс поднимает сервер, засевает данные и меряет геометрию.

**Files:**
- Create: `tools/package.json`
- Create: `tools/harness.mjs`
- Create: `tools/dt-check.mjs`
- Create: `tools/shots.mjs`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `harness.mjs` экспортирует `withPage(fn)`, `FIXTURE`, `rect(page, sel)`, `cssOf(page, sel, prop)`, `isVisible(page, sel)`; `dt-check.mjs` экспортирует `suite(width, title, fn)` и `check(name, fn)` для последующих задач.

- [ ] **Step 1: Завести tools/package.json**

```json
{
  "name": "void-tools",
  "private": true,
  "type": "module",
  "scripts": {
    "check": "node dt-check.mjs",
    "shots": "node shots.mjs"
  },
  "dependencies": {
    "puppeteer-core": "^23.0.0"
  }
}
```

- [ ] **Step 2: Добавить node_modules в .gitignore**

Дописать в конец `.gitignore`:

```
tools/node_modules/
tools/shots/
```

- [ ] **Step 3: Написать harness.mjs**

```js
// Общая обвязка: статический сервер, браузер, фикстура, геометрические хелперы.
// Каталог dev-only, в PRECACHE и index.html не подключается.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHROME = process.env.CHROME_PATH
  || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.gs': 'text/plain; charset=utf-8',
};

function serve() {
  return new Promise(resolve => {
    const srv = createServer(async (req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      const file = join(ROOT, normalize(p).replace(/^([/\\])+/, ''));
      try {
        const buf = await readFile(file);
        res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
        res.end(buf);
      } catch {
        res.writeHead(404).end('not found');
      }
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

// Фикстура текущего месяца: шесть категорий, часть с перерасходом,
// два банка и один кредитный. Реальный backup.json не используется —
// он в .gitignore, харнесс должен работать на чистом клоне.
const now = new Date();
const Y = now.getFullYear(), M = now.getMonth();
const MK = `${Y}-${String(M + 1).padStart(2, '0')}`;
const dd = n => `${MK}-${String(n).padStart(2, '0')}`;

export const FIXTURE = {
  categories: ['Аренда', 'Продукты + хозтовары + уход', 'Еда вне дома', 'Одежда', 'Хотелки', 'Мама'],
  catIds: ['cat0001', 'cat0002', 'cat0003', 'cat0004', 'cat0005', 'cat0006'],
  catColors: { 0: '#185fa5', 1: '#2d7a4f', 2: '#b07d1a', 3: '#c0392b', 4: '#7b4fa5', 5: '#1a7a7a' },
  expenses: [
    { id: 'e01', date: dd(1), cat: 0, catId: 'cat0001', amount: 36407, comment: '', special: true, updatedAt: 1 },
    { id: 'e02', date: dd(3), cat: 1, catId: 'cat0002', amount: 4210, comment: 'Пятёрочка', updatedAt: 1 },
    { id: 'e03', date: dd(5), cat: 1, catId: 'cat0002', amount: 3616, comment: 'Магнит', updatedAt: 1 },
    { id: 'e04', date: dd(6), cat: 2, catId: 'cat0003', amount: 11203, comment: '', updatedAt: 1 },
    { id: 'e05', date: dd(7), cat: 3, catId: 'cat0004', amount: 9456, comment: '', updatedAt: 1 },
    { id: 'e06', date: dd(8), cat: 4, catId: 'cat0005', amount: 18315, comment: '', updatedAt: 1 },
    { id: 'e07', date: dd(9), cat: 5, catId: 'cat0006', amount: 8200, comment: '', updatedAt: 1 },
    { id: 'e08', date: dd(10), cat: 1, catId: 'cat0002', amount: 5000, comment: 'Ашан', updatedAt: 1 },
  ],
  incomes: [
    { id: 'i01', date: dd(5), source: 'Зарплата', amount: 180000, tag: 'Оплата труда', updatedAt: 1 },
    { id: 'i02', date: dd(12), source: 'Вклад', amount: 27550, tag: 'Проценты', updatedAt: 1 },
  ],
  assets: [
    { id: 'a01', date: dd(1), bankName: 'Сбербанк', bank: 0, amount: 420000, updatedAt: 1 },
    { id: 'a02', date: dd(1), bankName: 'Т-Банк', bank: 1, amount: 310000, updatedAt: 1 },
  ],
  banks: ['Сбербанк', 'Т-Банк'],
  creditBanks: ['Альфа-Банк'],
  limits: { [MK]: [36298, 14094, 7988, 2669, 5000, 9000] },
  goals: [], templates: [], deposits: [], investments: [], credits: [],
  incomeTags: ['Оплата труда', 'Проценты'],
  incomeTagColors: { 0: '#185fa5', 1: '#2d7a4f' },
  incomeTagOrder: ['', 'Проценты'],
  listsMeta: {}, notifsEnabled: false, notifThreshold: 90,
};

/**
 * Поднимает сервер и браузер, отдаёт страницу в колбэк, всё закрывает.
 * fn(page, { width }) вызывается для каждой ширины из widths.
 */
export async function withPage(widths, fn) {
  const { srv, port } = await serve();
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--hide-scrollbars', '--font-render-hinting=none'],
  });
  try {
    for (const width of widths) {
      const page = await browser.newPage();
      await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
      await page.evaluateOnNewDocument(fx => {
        localStorage.setItem('budgetDB_v2', JSON.stringify(fx));
        // SW перезагружает страницу по controllerchange — в тестах это помеха.
        // Скрываем API целиком: регистрация в index.html за проверкой `in navigator`.
        Object.defineProperty(navigator, 'serviceWorker', { get: () => undefined });
      }, FIXTURE);
      await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'networkidle0' });
      await page.evaluate(() => document.fonts.ready);
      await fn(page, { width });
      await page.close();
    }
  } finally {
    await browser.close();
    srv.close();
  }
}

export const rect = (page, sel) => page.evaluate(s => {
  const el = document.querySelector(s);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}, sel);

export const cssOf = (page, sel, prop) => page.evaluate((s, p) => {
  const el = document.querySelector(s);
  return el ? getComputedStyle(el)[p] : null;
}, sel, prop);

export const isVisible = (page, sel) => page.evaluate(s => {
  const el = document.querySelector(s);
  if (!el) return false;
  const st = getComputedStyle(el);
  return st.display !== 'none' && st.visibility !== 'hidden' && el.getBoundingClientRect().width > 0;
}, sel);
```

- [ ] **Step 4: Написать dt-check.mjs с первой проверкой**

Первая проверка — базовая линия: на 390 px мобильная раскладка на месте. Она обязана проходить **до** любых изменений и после каждой задачи.

```js
// Проверки геометрии десктопной раскладки. Запуск: node tools/dt-check.mjs
import { withPage, rect, cssOf, isVisible } from './harness.mjs';

const results = [];
let current = null;

export function suite(width, title, fn) { SUITES.push({ width, title, fn }); }
export function check(name, fn) { current.checks.push({ name, fn }); }

const SUITES = [];

export function eq(actual, expected, what) {
  if (actual !== expected) throw new Error(`${what}: ожидалось ${expected}, получено ${actual}`);
}
export function near(actual, expected, what, tol = 1) {
  if (Math.abs(actual - expected) > tol) throw new Error(`${what}: ожидалось ~${expected}, получено ${actual}`);
}

// ─── ПРОВЕРКИ ───────────────────────────────────────────────────────
suite(390, 'мобильная база', () => {
  check('body ограничен 430 px', async p => {
    const r = await rect(p, 'body');
    near(r.width, 390, 'ширина body');
    eq(await cssOf(p, 'body', 'maxWidth'), '430px', 'max-width body');
  });
  check('навбар внизу, фиксированный', async p => {
    eq(await cssOf(p, 'nav.nav', 'position'), 'fixed', 'position навбара');
    const r = await rect(p, 'nav.nav');
    near(r.y + r.height, 900, 'низ навбара', 2); // высота вьюпорта в харнессе
  });
  check('контекстной колонки нет', async p => {
    eq(await isVisible(p, '#dt-ctx'), false, 'видимость #dt-ctx');
  });
});

// ─── РАННЕР ─────────────────────────────────────────────────────────
const byWidth = new Map();
for (const s of SUITES) {
  current = { checks: [] };
  s.fn();
  byWidth.set(s, current.checks);
}

let failed = 0;
await withPage([...new Set(SUITES.map(s => s.width))], async (page, { width }) => {
  for (const s of SUITES.filter(s => s.width === width)) {
    for (const c of byWidth.get(s)) {
      try {
        await c.fn(page);
        results.push(['ok', width, s.title, c.name, '']);
      } catch (e) {
        failed++;
        results.push(['FAIL', width, s.title, c.name, e.message]);
      }
    }
  }
});

for (const [st, w, t, n, msg] of results) {
  const mark = st === 'ok' ? '  ok  ' : ' FAIL ';
  console.log(`${mark} ${String(w).padStart(4)}  ${t} · ${n}${msg ? '\n        ' + msg : ''}`);
}
console.log(`\n${results.length - failed} из ${results.length} прошло`);
process.exit(failed ? 1 : 0);
```

- [ ] **Step 5: Написать shots.mjs**

```js
// Скриншоты всех вкладок на всех ширинах. Запуск: node tools/shots.mjs
import { mkdir } from 'node:fs/promises';
import { withPage } from './harness.mjs';

const WIDTHS = [390, 1000, 1280, 1440, 1600];
const PAGES = ['day', 'budget', 'income', 'stats', 'assets', 'settings'];
const OUT = new URL('shots/', import.meta.url);

await mkdir(OUT, { recursive: true });
await withPage(WIDTHS, async (page, { width }) => {
  for (const name of PAGES) {
    await page.evaluate(n => window.showPage(n, document.getElementById('nav-' + n)), name);
    await new Promise(r => setTimeout(r, 350)); // дать Chart.js дорисоваться
    await page.screenshot({
      path: new URL(`${String(width).padStart(4, '0')}-${name}.png`, OUT).pathname.slice(1),
      fullPage: true,
    });
  }
  console.log('снято', width);
});
console.log('готово:', OUT.pathname);
```

- [ ] **Step 6: Установить зависимости и прогнать базовую линию**

```bash
cd tools && npm install && node dt-check.mjs
```

Ожидается: 3 из 3 прошло, код возврата 0. Если Chrome лежит не по умолчанию — `CHROME_PATH=/путь/к/chrome.exe node dt-check.mjs`.

- [ ] **Step 7: Снять базовые скриншоты**

```bash
cd tools && node shots.mjs
```

Ожидается: 30 файлов в `tools/shots/`. Посмотреть `0390-day.png` и `1440-day.png` — сейчас обе узкие, это и есть проблема, которую решаем.

- [ ] **Step 8: Коммит**

```bash
git add tools/package.json tools/package-lock.json tools/harness.mjs tools/dt-check.mjs tools/shots.mjs .gitignore
git commit -m "test: puppeteer-харнесс для проверки раскладки"
```

---

### Task 2: Сабсеты шрифтов

Разовая нарезка. Результат — два коммитнутых `.woff2`; в рантайме и в CI ничего не собирается.

**Files:**
- Create: `tools/subset-fonts.sh`
- Create: `vendor/golos-text.woff2`
- Create: `vendor/jetbrains-digits.woff2`

**Interfaces:**
- Produces: `vendor/golos-text.woff2` (family `Golos Text`, вес 400–700), `vendor/jetbrains-digits.woff2` (family `JetBrains Mono`, вес 400–700).

- [ ] **Step 1: Написать скрипт нарезки**

Создать `tools/subset-fonts.sh`. Диапазоны выверены: `U+20BD` — знак рубля, `U+00A0` — разделитель разрядов, который `toLocaleString('ru-RU')` реально возвращает (проверено), `U+2116` — №, `U+2039-203A` — стрелки ‹ ›.

```bash
#!/usr/bin/env bash
# Разовая нарезка вендоренных гарнитур. Результат коммитится в vendor/.
# Перезапускать только при смене версии шрифта или набора символов.
set -euo pipefail
cd "$(dirname "$0")"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

curl -sL -o "$TMP/Golos.ttf" \
  "https://raw.githubusercontent.com/google/fonts/main/ofl/golostext/GolosText%5Bwght%5D.ttf"
curl -sL -o "$TMP/JB.ttf" \
  "https://raw.githubusercontent.com/google/fonts/main/ofl/jetbrainsmono/JetBrainsMono%5Bwght%5D.ttf"

# Текст: латиница, кириллица, ₽, №, типографские тире и кавычки, ‹ ›, −
TEXT_RANGE='U+0020-007E,U+00A0-00FF,U+0400-045F,U+0490-0491,U+2010-2015,U+2018-201F,U+2039-203A,U+2116,U+20BD,U+2212'
# Цифры: только то, что встречается в денежных строках
NUM_RANGE='U+0020,U+00A0,U+0025,U+002B,U+002C,U+002D,U+002E,U+002F,U+0030-0039,U+20BD,U+2212'

uv run --quiet --with fonttools --with brotli python -m fontTools.subset \
  "$TMP/Golos.ttf" --unicodes="$TEXT_RANGE" --flavor=woff2 \
  --layout-features='ccmp,locl,kern,tnum,calt' \
  --output-file=../vendor/golos-text.woff2

uv run --quiet --with fonttools --with brotli python -m fontTools.subset \
  "$TMP/JB.ttf" --unicodes="$NUM_RANGE" --flavor=woff2 \
  --layout-features='tnum,kern' \
  --output-file=../vendor/jetbrains-digits.woff2

ls -l ../vendor/golos-text.woff2 ../vendor/jetbrains-digits.woff2 |
  awk '{printf "%-34s %6.1f KB\n", $9, $5/1024}'
```

- [ ] **Step 2: Запустить и проверить размеры**

```bash
bash tools/subset-fonts.sh
```

Ожидается: `golos-text.woff2` ≈ 46–47 КБ, `jetbrains-digits.woff2` ≈ 3 КБ. Если сильно больше — диапазон задан шире, чем нужно.

- [ ] **Step 3: Проверить, что нужные глифы на месте**

```bash
PYTHONIOENCODING=utf-8 uv run --quiet --with fonttools --with brotli python -c "
from fontTools.ttLib import TTFont
for f,need in [('vendor/golos-text.woff2','АЯаяA9₽№—·‹'),('vendor/jetbrains-digits.woff2','0123456789₽,.%')]:
    cm=set(TTFont(f).getBestCmap())
    miss=[c for c in need if ord(c) not in cm]
    print(f, 'ОК' if not miss else 'НЕТ ГЛИФОВ: '+''.join(miss))
    print('  nbsp:', 0x00A0 in cm)
"
```

Ожидается: обе строки `ОК`, `nbsp: True` у обоих.

- [ ] **Step 4: Коммит**

```bash
git add tools/subset-fonts.sh vendor/golos-text.woff2 vendor/jetbrains-digits.woff2
git commit -m "feat(type): вендоренные сабсеты Golos Text и JetBrains Mono"
```

---

### Task 3: Подключение гарнитур

Первый деплоящийся кусок. Задевает и мобильную версию, поэтому идёт отдельным релизом — регрессию видно изолированно.

**Files:**
- Modify: `css/app.css:1-9` (токены), `:43` (`html,body`)
- Modify: `index.html:30` (`<link>` c `?v=`), `:1231` (версия), шапка (preload)
- Modify: `sw.js:5` (`V`), `:9-15` (`PRECACHE`)
- Modify: `tools/dt-check.mjs`

**Interfaces:**
- Consumes: `vendor/golos-text.woff2`, `vendor/jetbrains-digits.woff2` из задачи 2.
- Produces: CSS-переменные `--font-text` и `--font-num`; класс `.money` для денежных значений.

- [ ] **Step 1: Написать падающие проверки**

Дописать в `tools/dt-check.mjs` перед блоком «РАННЕР»:

```js
suite(390, 'типографика', () => {
  check('body набран Golos Text', async p => {
    const ff = await cssOf(p, 'body', 'fontFamily');
    if (!/Golos Text/.test(ff)) throw new Error(`fontFamily = ${ff}`);
  });
  check('обе гарнитуры реально загрузились', async p => {
    const miss = await p.evaluate(() =>
      ['Golos Text', 'JetBrains Mono'].filter(f => !document.fonts.check(`16px "${f}"`)));
    if (miss.length) throw new Error('не загрузились: ' + miss.join(', '));
  });
  check('денежные значения табличные и моноширинные', async p => {
    await p.evaluate(() => window.showPage('budget', document.getElementById('nav-budget')));
    const got = await p.evaluate(() => {
      const el = document.querySelector('#sum-spent');
      const st = getComputedStyle(el);
      return { fv: st.fontVariantNumeric, ff: st.fontFamily };
    });
    if (!/tabular-nums/.test(got.fv)) throw new Error(`font-variant-numeric = ${got.fv}`);
    if (!/JetBrains Mono/.test(got.ff)) throw new Error(`fontFamily = ${got.ff}`);
  });
});
```

- [ ] **Step 2: Убедиться, что проверки падают**

```bash
cd tools && node dt-check.mjs
```

Ожидается: три FAIL в блоке «типографика», `fontFamily = -apple-system, ...`.

- [ ] **Step 3: Добавить @font-face и токены**

В начало `css/app.css`, перед `:root{`:

```css
/* Вендоренные гарнитуры: сабсеты нарезаны tools/subset-fonts.sh.
   Golos Text — кириллица родная; JetBrains Mono — только цифры и денежные
   знаки (3 КБ), чтобы суммы читались как показания прибора.
   font-display:swap: до загрузки страница рисуется системным стеком. */
@font-face{
  font-family:'Golos Text';
  src:url('../vendor/golos-text.woff2') format('woff2');
  font-weight:400 700; font-style:normal; font-display:swap;
}
@font-face{
  font-family:'JetBrains Mono';
  src:url('../vendor/jetbrains-digits.woff2') format('woff2');
  font-weight:400 700; font-style:normal; font-display:swap;
}
```

В блок `:root{...}` дописать (символы `✓ ✕ ✎ ↻ ↳ ⌀ ∅ Δ` в Golos Text отсутствуют — их рисует системный фолбэк, он обязателен):

```css
  --font-text:'Golos Text',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
  --font-num:'JetBrains Mono',ui-monospace,'Cascadia Mono',Consolas,monospace;
```

- [ ] **Step 4: Перевести body на токен**

В `css/app.css` заменить в правиле `html,body`:

```css
font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
```

на:

```css
font-family:var(--font-text);
```

- [ ] **Step 5: Ввести класс .money и повесить его на денежные узлы**

В `css/app.css` после правил `.s-val`:

```css
/* Денежные значения: моноширинные табличные цифры, чтобы колонки сумм
   вставали знак под знак. Отрицательный трекинг компенсирует ширину моно. */
.money,.s-val,.cat-spent,.total-val,.day-total,.fig-v{
  font-family:var(--font-num);
  font-variant-numeric:tabular-nums;
  letter-spacing:-.02em;
}
```

- [ ] **Step 6: Добавить preload в index.html**

После строки `<link rel="stylesheet" href="css/app.css?v=...">` в `index.html`:

```html
<link rel="preload" href="vendor/golos-text.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="vendor/jetbrains-digits.woff2" as="font" type="font/woff2" crossorigin>
```

- [ ] **Step 7: Обновить PRECACHE и версии**

В `sw.js` в массив `PRECACHE` дописать две строки:

```js
  './vendor/golos-text.woff2',
  './vendor/jetbrains-digits.woff2'
```

Затем поднять версии: `const V = '2026-08-20 v1.51.0';` в `sw.js`; `v1.51.0` в `index.html:1231`; `css/app.css?v=1.51.0` в `<link>`.

- [ ] **Step 8: Прогнать проверки**

```bash
cd tools && node dt-check.mjs
```

Ожидается: 6 из 6 прошло.

- [ ] **Step 9: Проверить синтаксис инлайн-скриптов**

```bash
node -e "const html=require('fs').readFileSync('index.html','utf8');const re=/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g;let m,ok=true;while((m=re.exec(html))){try{new Function(m[1])}catch(e){ok=false;console.log('FAIL:',e.message)}};console.log(ok?'syntax OK':'ERRORS')"
```

Ожидается: `syntax OK`.

- [ ] **Step 10: Снять скриншоты и посмотреть глазами**

```bash
cd tools && node shots.mjs
```

Открыть `tools/shots/0390-budget.png` и `0390-assets.png`. Убедиться: кириллица не поехала, суммы выровнены, символы `✎ ✕ ⌀` на месте (их рисует системный шрифт — они могут отличаться по начертанию, это ожидаемо).

- [ ] **Step 11: Коммит**

```bash
git add css/app.css index.html sw.js tools/dt-check.mjs
git commit -m "feat(type): v1.51.0 — Golos Text + JetBrains Mono на цифрах"
```

---

### Task 4: Оболочка — грид и сайдбар

**Files:**
- Modify: `index.html:589-616` (обернуть подписи вкладок в `<span>`)
- Modify: `css/app.css` (новый блок `@media (min-width:1000px)` в конце файла)
- Modify: `tools/dt-check.mjs`

**Interfaces:**
- Consumes: токены гарнитур из задачи 3.
- Produces: грид `body` с областями `nav ctx main`; класс `.nav-lbl` на подписях вкладок.

- [ ] **Step 1: Написать падающие проверки**

```js
suite(1280, 'оболочка 1280', () => {
  check('сайдбар слева, 208 px, липкий', async p => {
    eq(await cssOf(p, 'nav.nav', 'position'), 'sticky', 'position навбара');
    const r = await rect(p, 'nav.nav');
    near(r.x, 0, 'левый край навбара');
    near(r.width, 208, 'ширина навбара');
    near(r.height, 900, 'высота навбара');
  });
  check('подписи вкладок видны', async p => {
    eq(await isVisible(p, '#nav-day .nav-lbl'), true, 'видимость подписи');
  });
  check('страница начинается после сайдбара и контекста', async p => {
    const r = await rect(p, '#page-day');
    near(r.x, 504, 'левый край страницы'); // 208 + 296
  });
  check('FAB спрятан', async p => {
    eq(await isVisible(p, '#fab'), false, 'видимость FAB');
  });
});

suite(1000, 'оболочка 1000', () => {
  check('сайдбар схлопнут в рельс 64 px', async p => {
    near((await rect(p, 'nav.nav')).width, 64, 'ширина рельса');
    eq(await isVisible(p, '#nav-day .nav-lbl'), false, 'видимость подписи');
  });
});
```

- [ ] **Step 2: Убедиться, что проверки падают**

```bash
cd tools && node dt-check.mjs
```

Ожидается: FAIL по всем пяти новым проверкам (`position навбара: ожидалось sticky, получено fixed` и т.д.).

- [ ] **Step 3: Обернуть подписи вкладок в span**

В `index.html` в каждой из шести `.nav-btn` обернуть текстовую подпись. Было:

```html
  <button class="nav-btn active" onclick="showPage('day',this)" id="nav-day">
    <svg viewBox="0 0 22 22" ...>...</svg>
    День
  </button>
```

Стало (аналогично для `nav-budget` → `Бюджет`, `nav-income` → `Доходы`, `nav-stats` → `Аналитика`, `nav-assets` → `Активы`, `nav-settings` → `Настройки`):

```html
  <button class="nav-btn active" onclick="showPage('day',this)" id="nav-day" title="День" aria-label="День">
    <svg viewBox="0 0 22 22" ...>...</svg>
    <span class="nav-lbl">День</span>
  </button>
```

`title` и `aria-label` нужны для режима рельса, где подпись скрыта.

- [ ] **Step 4: Добавить десктопный блок в CSS**

В конец `css/app.css`:

```css
/* ═══ ДЕСКТОП ═══════════════════════════════════════════════════════
   Ниже 1000 px ни одно правило отсюда не применяется — мобильная
   вёрстка остаётся ровно такой, какой была. */
@media (min-width:1000px){
  body{
    max-width:none; margin:0; padding-bottom:0;
    display:grid; min-height:100vh;
    grid-template-columns:64px 280px minmax(0,1fr);
    grid-template-areas:"nav ctx main";
  }

  /* НАВБАР → САЙДБАР */
  nav.nav{
    grid-area:nav; position:sticky; top:0; left:auto; transform:none;
    width:auto; max-width:none; height:100vh;
    flex-direction:column; justify-content:flex-start; gap:2px;
    border-top:none; border-right:.5px solid var(--border);
    padding:14px 8px;
  }
  .nav-btn{
    flex:none; flex-direction:row; gap:10px;
    justify-content:center; padding:10px 0; border-radius:var(--r-sm);
    font-size:13px; position:relative;
  }
  .nav-btn:hover{background:var(--bg)}
  .nav-btn.active{background:var(--bg)}
  /* Активная вкладка отмечается полоской слева — тем же приёмом,
     что и hairline-границы карточек, а не заливкой цветом. */
  .nav-btn.active::before{
    content:''; position:absolute; left:-8px; top:6px; bottom:6px;
    width:2px; background:var(--accent); border-radius:0 2px 2px 0;
  }
  .nav-lbl{display:none}

  /* СТРАНИЦЫ */
  .page{grid-area:main; min-width:0}
  .page.active{animation:fadeIn .18s ease}
  .page.slide-l,.page.slide-r{animation:fadeIn .18s ease}

  /* Плавающая кнопка — мобильная цитата, на широком экране не нужна */
  #fab{display:none !important}
}

@media (min-width:1200px){
  body{grid-template-columns:208px 296px minmax(0,1fr)}
  .nav-btn{justify-content:flex-start; padding:10px 12px}
  .nav-lbl{display:inline}
}
```

- [ ] **Step 5: Прогнать проверки**

```bash
cd tools && node dt-check.mjs
```

Ожидается: 11 из 11 прошло. Проверка «страница начинается после сайдбара и контекста» пройдёт потому, что грид уже резервирует колонку `ctx`, хотя узла в ней ещё нет.

- [ ] **Step 6: Убедиться, что мобильная база не поехала**

В выводе того же прогона блок «мобильная база» на 390 px обязан быть зелёным целиком. Если хоть одна проверка там покраснела — десктопные правила протекли ниже брейкпоинта, это дефект.

- [ ] **Step 7: Снять скриншоты**

```bash
cd tools && node shots.mjs
```

Посмотреть `1000-day.png` (рельс) и `1280-day.png` (сайдбар с подписями). Страница пока прижата вправо с пустой колонкой посередине — так и задумано, её заполнит задача 5.

- [ ] **Step 8: Коммит**

```bash
git add index.html css/app.css tools/dt-check.mjs
git commit -m "feat(desktop): грид-оболочка и сайдбар вместо нижнего таб-бара"
```

---

### Task 5: Контекстная колонка

**Files:**
- Modify: `index.html` (новый `<aside id="dt-ctx">` перед `<nav class="nav">`)
- Modify: `index.html` секция `═══ budget.js ═══` (функция `renderDeskCtx`, вызов в конце `renderBudget`)
- Modify: `css/app.css` (стили колонки в десктопном блоке)
- Modify: `tools/dt-check.mjs`

**Interfaces:**
- Consumes: `getLimits(y,m)`, `getCatSpent(idx,y,m)`, `getMonthExpenses(y,m)`, `_monthForecast(y,m)`, `_budgetFree(y,m,spent,limit,fc)`, `getCatColor(idx)`, `fmtH(n)`, `esc(s)`, `currentMonth`.
- Produces: `renderDeskCtx()` — без аргументов, читает `currentMonth`, ничего не возвращает.

- [ ] **Step 1: Написать падающие проверки**

```js
suite(1280, 'контекстная колонка', () => {
  check('колонка на месте, 296 px, липкая', async p => {
    eq(await isVisible(p, '#dt-ctx'), true, 'видимость #dt-ctx');
    const r = await rect(p, '#dt-ctx');
    near(r.x, 208, 'левый край колонки');
    near(r.width, 296, 'ширина колонки');
    eq(await cssOf(p, '#dt-ctx', 'position'), 'sticky', 'position колонки');
  });
  check('в колонке та же сумма, что на вкладке «Бюджет»', async p => {
    await p.evaluate(() => window.showPage('budget', document.getElementById('nav-budget')));
    const [ctx, page] = await p.evaluate(() => [
      document.querySelector('#dtc-spent').textContent.replace(/\s/g, ''),
      document.querySelector('#sum-spent').textContent.replace(/\s/g, ''),
    ]);
    eq(ctx, page, 'сумма в колонке против суммы на вкладке');
    if (/^0/.test(ctx)) throw new Error('сумма нулевая — фикстура не засеялась');
  });
  check('в колонке шесть категорий', async p => {
    const n = await p.evaluate(() => document.querySelectorAll('#dtc-cats .dtc-cat').length);
    eq(n, 6, 'число строк категорий');
  });
  check('помесячная шапка бюджета скрыта', async p => {
    await p.evaluate(() => window.showPage('budget', document.getElementById('nav-budget')));
    eq(await isVisible(p, '#page-budget .month-nav'), false, 'видимость month-nav');
  });
});
```

- [ ] **Step 2: Убедиться, что проверки падают**

```bash
cd tools && node dt-check.mjs
```

Ожидается: четыре FAIL, первый — `видимость #dt-ctx: ожидалось true, получено false`.

- [ ] **Step 3: Добавить разметку колонки**

В `index.html` непосредственно перед `<nav class="nav">`:

```html
<!-- ═══════════════════════════════════════════════════════════════
     КОНТЕКСТНАЯ КОЛОНКА (только десктоп, ≥1000px)
     Липкая: цифры месяца не уезжают при скролле рабочей области.
═══════════════════════════════════════════════════════════════ -->
<aside id="dt-ctx" aria-label="Контекст месяца">
  <div class="dtc-nav">
    <button class="mn-btn" onclick="dtcMonth(-1)" aria-label="Предыдущий месяц">‹</button>
    <span class="dtc-month" id="dtc-month"></span>
    <button class="mn-btn" onclick="dtcMonth(1)" aria-label="Следующий месяц">›</button>
  </div>
  <button class="btn" id="dtc-add" onclick="openAddExpense()">+ Расход</button>
  <div class="dtc-figs">
    <div class="dtc-fig lead"><span class="dtc-l">Потрачено</span><span class="dtc-v money" id="dtc-spent">0₽</span></div>
    <div class="dtc-fig"><span class="dtc-l">Лимит</span><span class="dtc-v money" id="dtc-limit">0₽</span></div>
    <div class="dtc-fig"><span class="dtc-l">Остаток</span><span class="dtc-v money" id="dtc-left">0₽</span></div>
    <div class="dtc-fig"><span class="dtc-l">Прогноз</span><span class="dtc-v money" id="dtc-fc">—</span></div>
  </div>
  <div class="dtc-bar"><i id="dtc-bar-fill"></i></div>
  <div class="sec-title" style="padding:0">Категории</div>
  <div id="dtc-cats"></div>
</aside>
```

- [ ] **Step 4: Написать renderDeskCtx**

В `index.html` в секцию `═══ budget.js ═══`, сразу после `_budgetFree`:

```js
// ─── КОНТЕКСТНАЯ КОЛОНКА (десктоп) ──────────────────────────────────
// Ничего не считает сама: берёт те же getLimits/_monthForecast/_budgetFree,
// что и бюджет, — иначе колонка и вкладка разойдутся в цифрах.
function _isDesktop(){ return matchMedia('(min-width:1000px)').matches; }

function renderDeskCtx(){
  const box = document.getElementById('dt-ctx');
  if(!box || !_isDesktop()) return;
  const {y, m} = currentMonth;
  const lims = getLimits(y, m);
  let spent = 0, limit = 0;
  const rows = DB.categories.map((name, i) => {
    const s = getCatSpent(i, y, m), l = lims[i] || 0;
    spent += s; limit += l;
    return {name, i, s, l};
  });
  const fc = _monthForecast(y, m);

  document.getElementById('dtc-month').textContent =
    new Date(y, m, 1).toLocaleDateString('ru-RU', {month:'long', year:'numeric'});
  document.getElementById('dtc-spent').innerHTML = fmtH(spent);
  document.getElementById('dtc-limit').innerHTML = fmtH(limit);

  const left = limit - spent;
  const leftEl = document.getElementById('dtc-left');
  leftEl.innerHTML = fmtH(left);
  leftEl.classList.toggle('over', left < 0);

  const fcEl = document.getElementById('dtc-fc');
  if(fc){
    fcEl.innerHTML = fmtH(fc.total);
    fcEl.classList.toggle('over', limit > 0 && fc.total > limit);
  } else {
    fcEl.textContent = '—';
    fcEl.classList.remove('over');
  }

  const pct = limit > 0 ? Math.min(100, Math.round(spent / limit * 100)) : 0;
  const fill = document.getElementById('dtc-bar-fill');
  fill.style.width = pct + '%';
  fill.classList.toggle('over', limit > 0 && spent > limit);

  // Топ-6 по тратам: колонка — сводка, полный список живёт на вкладке «Бюджет»
  const top = rows.filter(r => r.s > 0).sort((a, b) => b.s - a.s).slice(0, 6);
  document.getElementById('dtc-cats').innerHTML = top.map(r => {
    const over = r.l > 0 && r.s > r.l;
    const p = r.l > 0 ? Math.round(r.s / r.l * 100) : null;
    return `<div class="dtc-cat" onclick="openCatExpenses(${r.i})">
      <span class="dtc-dot" style="background:${getCatColor(r.i)}"></span>
      <span class="dtc-cn">${esc(r.name)}</span>
      <span class="dtc-cv money${over ? ' over' : ''}">${fmtH(r.s)}</span>
      <span class="dtc-cp money">${p === null ? '' : p + '%'}</span>
    </div>`;
  }).join('') || '<div class="dtc-empty">Трат в этом месяце нет</div>';
}

// Переключение месяца из колонки. Единый навигатор на десктопе:
// тянет за собой доходы и день (см. задачу 6).
function dtcMonth(d){ changeMonth(d); }
```

- [ ] **Step 5: Вызвать renderDeskCtx из renderBudget**

В `index.html` в самый конец функции `renderBudget()` (перед закрывающей `}`) дописать:

```js
  renderDeskCtx();
```

- [ ] **Step 6: Добавить стили колонки**

В `css/app.css` внутрь блока `@media (min-width:1000px)`:

```css
  /* КОНТЕКСТНАЯ КОЛОНКА */
  #dt-ctx{
    grid-area:ctx; position:sticky; top:0; align-self:start;
    height:100vh; overflow-y:auto;
    background:var(--card); border-right:.5px solid var(--border);
    padding:14px 16px 20px;
    display:flex; flex-direction:column; gap:12px;
  }
  .dtc-nav{display:flex; align-items:center; gap:6px}
  .dtc-nav .mn-btn{width:28px; height:28px; font-size:15px}
  .dtc-month{flex:1; text-align:center; font-size:13px; font-weight:600; text-transform:capitalize}
  #dtc-add{width:100%; flex:none}
  .dtc-figs{display:flex; flex-direction:column; gap:7px}
  .dtc-fig{display:flex; align-items:baseline; justify-content:space-between; gap:10px}
  .dtc-l{font-size:11.5px; color:var(--muted)}
  .dtc-v{font-size:15px; font-weight:600}
  .dtc-fig.lead .dtc-v{font-size:23px; letter-spacing:-.03em; line-height:1.1}
  .dtc-v.over{color:var(--red)}
  .dtc-bar{height:5px; border-radius:3px; background:var(--border); overflow:hidden}
  .dtc-bar > i{display:block; height:100%; background:var(--accent); transition:width .2s}
  .dtc-bar > i.over{background:var(--red)}
  .dtc-cat{
    display:grid; grid-template-columns:8px 1fr auto auto; gap:8px;
    align-items:baseline; padding:6px 0; cursor:pointer;
    border-bottom:.5px solid var(--border);
  }
  .dtc-cat:hover{background:var(--bg)}
  .dtc-dot{width:8px; height:8px; border-radius:2px; align-self:center}
  .dtc-cn{font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap}
  .dtc-cv{font-size:12px; font-weight:600}
  .dtc-cv.over{color:var(--red)}
  .dtc-cp{font-size:10.5px; color:var(--hint); min-width:34px; text-align:right}
  .dtc-empty{font-size:12px; color:var(--muted); padding:8px 0}

  /* Помесячные шапки внутри вкладок: месяцем рулит колонка, два
     конкурирующих контрола на одном экране недопустимы. */
  #page-budget .month-nav,#page-income .month-nav{display:none}
```

- [ ] **Step 7: Прогнать проверки**

```bash
cd tools && node dt-check.mjs
```

Ожидается: 15 из 15 прошло, включая зелёную мобильную базу.

- [ ] **Step 8: Проверить синтаксис и снять скриншоты**

```bash
node -e "const html=require('fs').readFileSync('index.html','utf8');const re=/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g;let m,ok=true;while((m=re.exec(html))){try{new Function(m[1])}catch(e){ok=false;console.log('FAIL:',e.message)}};console.log(ok?'syntax OK':'ERRORS')"
cd tools && node shots.mjs
```

Посмотреть `1280-budget.png`: колонка слева с цифрами, справа полный список категорий.

- [ ] **Step 9: Коммит**

```bash
git add index.html css/app.css tools/dt-check.mjs
git commit -m "feat(desktop): липкая контекстная колонка месяца"
```

---

### Task 6: Унификация месяца

Самое инвазивное место плана: задевает функции, которыми пользуется и мобильная версия.

**Files:**
- Modify: `index.html:1748-1780` (`changeMonth`, `changeDay`, `onBudgetMonthChange`)
- Modify: `index.html` секция `═══ income.js ═══` (`changeIncomeMonth`, `onIncomeMonthChange`)
- Modify: `tools/dt-check.mjs`

**Interfaces:**
- Consumes: `currentMonth`, `currentDay`, `currentIncomeMonth`, `renderBudget()`, `renderDay()`, `renderIncome()`, `renderDeskCtx()`, `today()`.
- Produces: `_syncMonthContext(y, m)` — приводит `currentIncomeMonth` и `currentDay` к месяцу `(y, m)`; вызывается только при ≥1000 px.

- [ ] **Step 1: Написать падающие проверки**

```js
suite(1280, 'единый месяц', () => {
  check('переключение месяца в колонке тянет доходы и день', async p => {
    const before = await p.evaluate(() => currentDay);
    await p.evaluate(() => window.dtcMonth(-1));
    const got = await p.evaluate(() => ({
      m: currentMonth.m, y: currentMonth.y,
      inc: currentIncomeMonth, day: currentDay,
    }));
    const mk = `${got.y}-${String(got.m + 1).padStart(2, '0')}`;
    if (!got.day.startsWith(mk)) throw new Error(`currentDay = ${got.day}, ожидался месяц ${mk}`);
    if (!(got.inc && got.inc.y === got.y && got.inc.m === got.m))
      throw new Error(`currentIncomeMonth = ${JSON.stringify(got.inc)}, ожидался ${mk}`);
    if (before === got.day) throw new Error('currentDay не изменился');
  });
  check('колонка показывает тот же месяц', async p => {
    const [label, state] = await p.evaluate(() => [
      document.getElementById('dtc-month').textContent,
      new Date(currentMonth.y, currentMonth.m, 1).toLocaleDateString('ru-RU', {month:'long', year:'numeric'}),
    ]);
    eq(label, state, 'подпись месяца');
  });
});

suite(390, 'месяц на мобиле независим', () => {
  check('changeMonth не трогает день и доходы', async p => {
    const before = await p.evaluate(() => ({ day: currentDay, inc: JSON.stringify(currentIncomeMonth) }));
    await p.evaluate(() => window.changeMonth(-1));
    const after = await p.evaluate(() => ({ day: currentDay, inc: JSON.stringify(currentIncomeMonth) }));
    eq(after.day, before.day, 'currentDay после changeMonth');
    eq(after.inc, before.inc, 'currentIncomeMonth после changeMonth');
  });
});
```

- [ ] **Step 2: Убедиться, что проверки падают**

```bash
cd tools && node dt-check.mjs
```

Ожидается: FAIL на «переключение месяца в колонке тянет доходы и день»; мобильная проверка при этом уже зелёная (текущее поведение и есть независимое).

- [ ] **Step 3: Ввести _syncMonthContext**

В `index.html` в секцию `═══ nav.js ═══`, сразу перед `function changeMonth(d){`:

```js
// ─── ЕДИНЫЙ МЕСЯЦ (только десктоп) ──────────────────────────────────
// На широком экране месяцем рулит контекстная колонка: помесячные шапки
// вкладок скрыты, поэтому доходы и день обязаны следовать за ней, иначе
// пользователь останется на прошлом месяце без единого видимого контрола.
// На мобиле каждая вкладка по-прежнему живёт своим месяцем.
// `_isDesktop()` уже объявлена в задаче 5 рядом с renderDeskCtx.
function _syncMonthContext(y, m){
  if(!_isDesktop()) return;
  currentIncomeMonth = {y, m};
  const t = today();
  const mk = y + '-' + String(m + 1).padStart(2, '0');
  // Текущий месяц — встаём на сегодня, прошлый или будущий — на 1-е число
  currentDay = t.startsWith(mk) ? t : mk + '-01';
}
```

- [ ] **Step 4: Подключить синхронизацию к переключателям месяца**

В `changeMonth(d)` после блока с переносом года и перед `renderBudget();`:

```js
  _syncMonthContext(currentMonth.y, currentMonth.m);
```

В `onBudgetMonthChange(val)` после `currentMonth = {y, m:m-1};`:

```js
  _syncMonthContext(currentMonth.y, currentMonth.m);
```

- [ ] **Step 5: Дорисовать зависимые вкладки**

В `changeMonth(d)` заменить хвост:

```js
  renderBudget();
  syncBudgetMonthInput();
```

на:

```js
  renderBudget();
  syncBudgetMonthInput();
  // Скрытые вкладки перерисовываем тоже: при возврате на них
  // не должно оказаться данных прошлого месяца
  if(_isDesktop()){ renderDay(); renderIncome(); }
```

То же дописать в конец `onBudgetMonthChange(val)`.

- [ ] **Step 6: Прогнать проверки**

```bash
cd tools && node dt-check.mjs
```

Ожидается: 18 из 18 прошло. Особое внимание — блок «месяц на мобиле независим» обязан остаться зелёным: это гарантия, что унификация не протекла на телефон.

- [ ] **Step 7: Проверить синтаксис**

```bash
node -e "const html=require('fs').readFileSync('index.html','utf8');const re=/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g;let m,ok=true;while((m=re.exec(html))){try{new Function(m[1])}catch(e){ok=false;console.log('FAIL:',e.message)}};console.log(ok?'syntax OK':'ERRORS')"
```

- [ ] **Step 8: Коммит**

```bash
git add index.html tools/dt-check.mjs
git commit -m "feat(desktop): контекстная колонка — единый навигатор по месяцу"
```

---

### Task 7: Инспектор

**Files:**
- Modify: `index.html` (атрибут `data-dt` на 28 оверлеях)
- Modify: `index.html:1667-1668` (`openModal`, `closeModal`), секция `═══ init.js ═══` (обработчик Escape)
- Modify: `css/app.css` (амплуа оверлеев в десктопном блоке)
- Modify: `tools/dt-check.mjs`

**Interfaces:**
- Consumes: `openModal(id)`, `closeModal(id)`, `initOverlays()`.
- Produces: класс `body.insp-open`; атрибут `data-dt` со значениями `insp` | `dialog` | `confirm`.

- [ ] **Step 1: Написать падающие проверки**

```js
suite(1600, 'инспектор 1600', () => {
  check('панель записи встаёт четвёртой колонкой', async p => {
    await p.evaluate(() => window.openAddExpense());
    const ins = await rect(p, '#modal-expense .sheet');
    near(ins.width, 380, 'ширина инспектора');
    near(ins.x, 1220, 'левый край инспектора', 2); // 1600 − 380
    near(ins.height, 900, 'высота инспектора');
    eq(await p.evaluate(() => document.body.classList.contains('insp-open')), true, 'класс insp-open');
  });
  check('рабочая область не перекрыта', async p => {
    const page = await rect(p, '#page-day');
    const ins = await rect(p, '#modal-expense .sheet');
    if (page.x + page.width > ins.x + 1)
      throw new Error(`страница заходит под инспектор: ${page.x + page.width} > ${ins.x}`);
  });
  check('Escape закрывает', async p => {
    await p.keyboard.press('Escape');
    eq(await isVisible(p, '#modal-expense'), false, 'видимость модалки');
    eq(await p.evaluate(() => document.body.classList.contains('insp-open')), false, 'класс insp-open');
  });
  check('менеджер открывается диалогом по центру, а не панелью', async p => {
    await p.evaluate(() => window.openCatManager());
    const r = await rect(p, '#modal-cats .sheet');
    if (r.width > 560) throw new Error(`ширина диалога ${r.width}`);
    const cx = r.x + r.width / 2;
    near(cx, 800, 'центр диалога', 4);
    eq(await p.evaluate(() => document.body.classList.contains('insp-open')), false, 'insp-open для диалога');
    await p.keyboard.press('Escape');
  });
});

suite(390, 'модалки на мобиле — шторки', () => {
  check('шторка снизу во всю ширину', async p => {
    await p.evaluate(() => window.openAddExpense());
    const r = await rect(p, '#modal-expense .sheet');
    near(r.width, 390, 'ширина шторки');
    if (r.y + r.height < 800) throw new Error(`шторка не прижата книзу: низ ${r.y + r.height}`);
    await p.evaluate(() => window.closeModal('modal-expense'));
  });
});
```

- [ ] **Step 2: Убедиться, что проверки падают**

```bash
cd tools && node dt-check.mjs
```

Ожидается: FAIL по всем четырём десктопным; мобильная — зелёная.

- [ ] **Step 3: Проставить data-dt на все 28 оверлеев**

В `index.html` добавить атрибут в открывающий тег каждого оверлея, например
`<div class="overlay" data-dt="insp" id="modal-expense">`.

`data-dt="insp"` — `modal-expense`, `modal-income`, `modal-cat-expenses`, `modal-template`, `modal-goal`, `modal-goal-topup`, `modal-deposit`, `modal-dep-contrib`, `modal-close-deposit`, `modal-investment`, `modal-inv-snap`, `modal-inv-contrib`, `modal-grace`, `modal-split`, `modal-split-view`.

`data-dt="dialog"` — `modal-limits`, `modal-cats`, `modal-banks`, `modal-templates`, `modal-income-tags`, `modal-asset-edit`, `modal-data-audit`, `modal-script`, `modal-sync`, `modal-sync-choice`, `modal-about`.

`data-dt="confirm"` — `modal-confirm-clear`, `modal-delete-income-tag`.

Проверить, что ни один не забыт:

```bash
PYTHONIOENCODING=utf-8 uv run --quiet python -c "
import io,re
s=io.open('index.html',encoding='utf-8').read()
ov=re.findall(r'<div class=\"overlay\"([^>]*)id=\"([^\"]+)\"',s)
bad=[i for a,i in ov if 'data-dt' not in a]
print('всего',len(ov),'| без data-dt:',bad or 'нет')
"
```

Ожидается: `всего 28 | без data-dt: нет`.

- [ ] **Step 4: Научить openModal/closeModal переключать insp-open**

Заменить в `index.html` строки 1667–1668:

```js
function openModal(id){document.getElementById(id).classList.add('open');}
function closeModal(id){document.getElementById(id).classList.remove('open');}
```

на:

```js
// На десктопе оверлеи с data-dt="insp" — правая панель. При ≥1440px она
// становится четвёртой колонкой грида, для чего body нужен класс insp-open.
function _isInspector(el){
  return el.dataset.dt === 'insp' && matchMedia('(min-width:1440px)').matches;
}
function openModal(id){
  const el = document.getElementById(id);
  el.classList.add('open');
  if(_isInspector(el)) document.body.classList.add('insp-open');
}
function closeModal(id){
  const el = document.getElementById(id);
  el.classList.remove('open');
  // Снимаем класс только если не осталось других открытых панелей
  if(!document.querySelector('.overlay.open[data-dt="insp"]'))
    document.body.classList.remove('insp-open');
}
```

- [ ] **Step 5: Добавить закрытие по Escape**

В `index.html` в функцию `initOverlays()`, после существующего `forEach`:

```js
  // Esc закрывает верхний открытый оверлей. На десктопе подложки под
  // курсором может не быть вовсе — панель прижата к правому краю.
  document.addEventListener('keydown', e => {
    if(e.key !== 'Escape') return;
    const open = document.querySelectorAll('.overlay.open');
    if(!open.length) return;
    closeModal(open[open.length - 1].id);
  });
```

- [ ] **Step 6: Добавить CSS амплуа**

В `css/app.css` внутрь блока `@media (min-width:1000px)`:

```css
  /* ОВЕРЛЕИ: три десктопных амплуа вместо нижней шторки.
     Содержимое модалок не меняется — только позиционирование. */
  .sheet::before{display:none}          /* полоска-хваталка — мобильная цитата */
  .overlay{align-items:center}
  .sheet{
    max-width:560px; max-height:88vh;
    border-radius:var(--r);
    padding:22px 24px;
  }

  /* insp — правая панель во всю высоту */
  .overlay[data-dt="insp"]{
    justify-content:flex-end; align-items:stretch;
    background:rgba(0,0,0,.28);
  }
  .overlay[data-dt="insp"] .sheet{
    width:380px; max-width:380px;
    height:100vh; max-height:100vh;
    border-radius:0; border-left:.5px solid var(--border);
    overflow-y:auto;
  }

  /* confirm — компактное окно */
  .overlay[data-dt="confirm"] .sheet{max-width:380px}
}

@media (min-width:1440px){
  /* Инспектор перестаёт быть наложением и становится четвёртой колонкой.
     Работает потому, что .overlay — прямой потомок body, то есть
     полноценный грид-элемент. */
  body.insp-open{grid-template-columns:208px 296px minmax(0,1fr) 380px}
  body.insp-open .overlay[data-dt="insp"].open{
    position:static; display:block; background:none;
    grid-column:4; grid-row:1;
  }
  body.insp-open .overlay[data-dt="insp"].open .sheet{
    position:sticky; top:0;
  }
}
```

- [ ] **Step 7: Прогнать проверки**

```bash
cd tools && node dt-check.mjs
```

Ожидается: 23 из 23 прошло.

- [ ] **Step 8: Снять скриншоты всех модалок**

Дописать в конец `tools/shots.mjs`:

```js
// Все оверлеи в трёх амплуа — основная визуальная проверка задачи 7
const MODALS = await (async () => {
  const { readFile } = await import('node:fs/promises');
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  return [...html.matchAll(/<div class="overlay"[^>]*id="([^"]+)"/g)].map(m => m[1]);
})();

await withPage([390, 1280, 1600], async (page, { width }) => {
  for (const id of MODALS) {
    await page.evaluate(i => window.openModal(i), id);
    await new Promise(r => setTimeout(r, 120));
    await page.screenshot({
      path: new URL(`m-${String(width).padStart(4, '0')}-${id}.png`, OUT).pathname.slice(1),
    });
    await page.evaluate(i => window.closeModal(i), id);
  }
  console.log('модалки сняты', width);
});
```

```bash
cd tools && node shots.mjs
```

Ожидается: 84 файла `m-*.png`. Просмотреть все. Искать: обрезанный контент, горизонтальный скролл внутри `.sheet`, налезающие кнопки. Особое внимание — `m-1280-modal-data-audit.png` (широкие таблицы), `m-1280-modal-limits.png` (длинный список), `m-1280-modal-split-view.png` (генератор графика).

- [ ] **Step 9: Проверить синтаксис и поднять версии**

```bash
node -e "const html=require('fs').readFileSync('index.html','utf8');const re=/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g;let m,ok=true;while((m=re.exec(html))){try{new Function(m[1])}catch(e){ok=false;console.log('FAIL:',e.message)}};console.log(ok?'syntax OK':'ERRORS')"
```

Поднять: `const V = '2026-08-20 v1.52.0';` в `sw.js`; `v1.52.0` в `index.html:1231`; `css/app.css?v=1.52.0` в `<link>`.

- [ ] **Step 10: Коммит**

```bash
git add index.html css/app.css tools/dt-check.mjs tools/shots.mjs sw.js
git commit -m "feat(desktop): v1.52.0 — инспектор вместо модалок, Escape закрывает"
```

---

## Ручная приёмка перед деплоем

Автоматика геометрию проверяет, а следующее — нет.

- [ ] Открыть на настоящем мониторе, потянуть окно от 1600 до 380 px. Три перескока (1440, 1200, 1000) — без прыжков контента и без горизонтального скролла.
- [ ] Прощёлкать все 10 тем в настройках на ширине 1280. Контекстная колонка и инспектор не должны терять контраст ни в одной.
- [ ] Включить приватный режим: суммы в контекстной колонке и в инспекторе обязаны размываться (`.prv`).
- [ ] Офлайн: DevTools → Network → Offline, перезагрузка. Белого экрана нет, шрифты на месте (взялись из precache).
- [ ] iPhone PWA после деплоя: вёрстка не изменилась нигде, кроме гарнитуры. Проверить «День», «Бюджет», «Активы» и любую модалку.
- [ ] Синхронизация: `syncCycle()` отработал, `_dirty` снялся. Оболочка данных не касается, но убедиться стоит.

## Что дальше

Часть 2 (`docs/superpowers/plans/` — писать после приёмки этой): раскладка вкладок в две-три колонки, вынос высот графиков в классы `.chart-h-sm` / `.chart-h-md`, редактор лимитов прямо на странице «Бюджет».
